#include "../protocol/common.hpp"
#include <bcrypt.h>
#include <map>
#include <memory>
#include <sstream>
#include <iomanip>
#include <cstring>

struct Hash {BCRYPT_ALG_HANDLE alg=nullptr;BCRYPT_HASH_HANDLE hash=nullptr;Hash(){if(BCryptOpenAlgorithmProvider(&alg,BCRYPT_SHA256_ALGORITHM,nullptr,0)<0||BCryptCreateHash(alg,&hash,nullptr,0,nullptr,0,0)<0)throw std::runtime_error("SHA256 init failed");}~Hash(){if(hash)BCryptDestroyHash(hash);if(alg)BCryptCloseAlgorithmProvider(alg,0);}void update(const char*p,DWORD n){if(BCryptHashData(hash,(PUCHAR)p,n,0)<0)throw std::runtime_error("SHA256 failed");}std::string finish(){unsigned char out[32];if(BCryptFinishHash(hash,out,32,0)<0)throw std::runtime_error("SHA256 finish failed");std::ostringstream s;for(auto b:out)s<<std::hex<<std::setw(2)<<std::setfill('0')<<int(b);return s.str();}};
std::map<std::string,std::unique_ptr<Handle>> held;
struct Listing {HANDLE find; WIN32_FIND_DATAW data;std::string path;bool first=true;~Listing(){FindClose(find);}};
std::map<std::string,std::unique_ptr<Listing>> listings;
void checkIdentity(HANDLE h,const json&r){if(identity(h)!=r.at("identity").get<std::string>())throw std::runtime_error("SOURCE_CHANGED: file identity differs");if(r.contains("expectedSize")&&r.contains("expectedMtime")){BY_HANDLE_FILE_INFORMATION i{};wincheck(GetFileInformationByHandle(h,&i),"Read source version");double mtime=double(number(i.ftLastWriteTime.dwHighDateTime,i.ftLastWriteTime.dwLowDateTime)/10000)-11644473600000.0;if(number(i.nFileSizeHigh,i.nFileSizeLow)!=r.at("expectedSize").get<uint64_t>()||mtime!=r.at("expectedMtime").get<double>())throw std::runtime_error("SOURCE_CHANGED: file contents changed after confirmation");}}
void renameHandle(HANDLE h,const std::string& target){auto w=longpath(target);std::vector<char> buffer(sizeof(FILE_RENAME_INFO)+w.size()*sizeof(wchar_t));auto info=(FILE_RENAME_INFO*)buffer.data();info->ReplaceIfExists=FALSE;info->RootDirectory=nullptr;info->FileNameLength=DWORD(w.size()*sizeof(wchar_t));memcpy(info->FileName,w.data(),info->FileNameLength);wincheck(SetFileInformationByHandle(h,FileRenameInfo,info,DWORD(buffer.size())),"Rename without replacement");}
json command(const json&r){const auto cmd=r.at("method").get<std::string>();
 if(cmd=="stat")return fileInfo(r.at("path"));
 if(cmd=="list"){
  std::string token=r.value("cursor","");if(token.empty()){token=r.at("id").get<std::string>();auto x=std::make_unique<Listing>();x->path=r.at("path");x->find=FindFirstFileW((longpath(x->path)+L"\\*").c_str(),&x->data);if(x->find==INVALID_HANDLE_VALUE){if(GetLastError()==ERROR_FILE_NOT_FOUND)return {{"entries",json::array()},{"cursor",nullptr}};wincheck(false,"Enumerate directory");}listings[token]=std::move(x);}
  auto it=listings.find(token);if(it==listings.end())throw std::runtime_error("Directory cursor expired");auto& x=*it->second;json rows=json::array();bool done=false;
  while(rows.size()<200){if(!x.first&&!FindNextFileW(x.find,&x.data)){wincheck(GetLastError()==ERROR_NO_MORE_FILES,"Directory enumeration interrupted");done=true;break;}x.first=false;auto name=utf8(x.data.cFileName);if(name=="."||name=="..")continue;
   try{auto data=fileInfo(x.path+"\\"+name);data["name"]=name;rows.push_back(data);}catch(const std::exception&e){rows.push_back({{"name",name},{"error",e.what()}});}
  }if(done)listings.erase(it);return {{"entries",rows},{"cursor",done?json(nullptr):json(token)}};
 }
 if(cmd=="rename"){Handle h(openFile(r.at("source"),DELETE|FILE_READ_ATTRIBUTES,FILE_SHARE_READ));checkIdentity(h.h,r);renameHandle(h.h,r.at("destination"));return {{"identity",identity(h.h)}};}
 if(cmd=="mkdir"){wincheck(CreateDirectoryW(longpath(r.at("path")).c_str(),nullptr),"Create directory without replacement");return fileInfo(r.at("path"));}
 if(cmd=="copy"){
  std::string source=r.at("source"),target=r.at("temporary"),token=r.at("token");auto h=std::make_unique<Handle>(openFile(source,GENERIC_READ|DELETE,FILE_SHARE_READ));checkIdentity(h->h,r);
  BY_HANDLE_FILE_INFORMATION inf{};wincheck(GetFileInformationByHandle(h->h,&inf),"Source information");if(inf.dwFileAttributes&(FILE_ATTRIBUTE_REPARSE_POINT|FILE_ATTRIBUTE_DIRECTORY|FILE_ATTRIBUTE_ENCRYPTED))throw std::runtime_error("Unsupported special file for cross-volume move");
  WIN32_FIND_STREAM_DATA sd{};HANDLE sh=FindFirstStreamW(longpath(source).c_str(),FindStreamInfoStandard,&sd,0);if(sh!=INVALID_HANDLE_VALUE){bool extra=false;do{if(wcscmp(sd.cStreamName,L"::$DATA"))extra=true;}while(FindNextStreamW(sh,&sd));FindClose(sh);if(extra)throw std::runtime_error("File has alternate data streams; source retained");}else if(GetLastError()!=ERROR_HANDLE_EOF && GetLastError()!=ERROR_INVALID_PARAMETER)wincheck(false,"Inspect data streams");
  Handle dest(CreateFileW(longpath(target).c_str(),GENERIC_WRITE|GENERIC_READ,0,nullptr,CREATE_NEW,FILE_ATTRIBUTE_NORMAL,nullptr));wincheck(dest.h!=INVALID_HANDLE_VALUE,"Create exclusive copy");std::vector<char> buffer(1024*1024);Hash sourceHash;DWORD read=0,written=0;uint64_t total=0;
  const auto cancel=r.value("cancelPath","");while(true){if(!cancel.empty()&&GetFileAttributesW(longpath(cancel).c_str())!=INVALID_FILE_ATTRIBUTES)throw std::runtime_error("CANCELLED: source retained");wincheck(ReadFile(h->h,buffer.data(),DWORD(buffer.size()),&read,nullptr),"Read source");if(!read)break;wincheck(WriteFile(dest.h,buffer.data(),read,&written,nullptr)&&written==read,"Write copy");sourceHash.update(buffer.data(),read);total+=read;}
  wincheck(FlushFileBuffers(dest.h),"Flush copy");LARGE_INTEGER zero{};wincheck(SetFilePointerEx(dest.h,zero,nullptr,FILE_BEGIN),"Rewind copy");Hash targetHash;while(true){wincheck(ReadFile(dest.h,buffer.data(),DWORD(buffer.size()),&read,nullptr),"Verify copy");if(!read)break;targetHash.update(buffer.data(),read);}auto hash=sourceHash.finish();if(hash!=targetHash.finish()||total!=number(inf.nFileSizeHigh,inf.nFileSizeLow))throw std::runtime_error("Copy checksum mismatch; source retained");
  wincheck(SetFileTime(dest.h,&inf.ftCreationTime,&inf.ftLastAccessTime,&inf.ftLastWriteTime),"Preserve timestamps");wincheck(FlushFileBuffers(dest.h),"Flush metadata");held[token]=std::move(h);return {{"hash",hash},{"size",total},{"identity",identity(dest.h)},{"attributes",inf.dwFileAttributes}};
 }
 if(cmd=="publish"){Handle h(openFile(r.at("temporary"),DELETE|FILE_READ_ATTRIBUTES,FILE_SHARE_READ));checkIdentity(h.h,r);renameHandle(h.h,r.at("destination"));auto ident=identity(h.h);return {{"identity",ident}};}
 if(cmd=="removeHeld"){auto token=r.at("token").get<std::string>();auto it=held.find(token);if(it==held.end())throw std::runtime_error("RECOVERY_REQUIRED: source lease expired");checkIdentity(it->second->h,r);FILE_DISPOSITION_INFO info{TRUE};wincheck(SetFileInformationByHandle(it->second->h,FileDispositionInfo,&info,sizeof(info)),"Source deletion failed; both copies retained");held.erase(it);return true;}
 if(cmd=="release"){held.erase(r.at("token").get<std::string>());return true;}
 if(cmd=="removeEmpty"){Handle h(openFile(r.at("path"),DELETE|FILE_READ_ATTRIBUTES,FILE_SHARE_READ));checkIdentity(h.h,r);FILE_DISPOSITION_INFO info{TRUE};wincheck(SetFileInformationByHandle(h.h,FileDispositionInfo,&info,sizeof(info)),"Remove empty directory");return true;}
 if(cmd=="attributes"){wincheck(SetFileAttributesW(longpath(r.at("path")).c_str(),r.at("attributes")),"Preserve file attributes");return true;}
 throw std::runtime_error("Unknown filesystem operation");
}
int main(){SetErrorMode(SEM_FAILCRITICALERRORS|SEM_NOGPFAULTERRORBOX);return serve(command);}
