#pragma once
#include <windows.h>
#include <string>
#include <iostream>
#include <stdexcept>
#include <vector>
#include "../vendor/json.hpp"
using json = nlohmann::json;
inline std::wstring wide(const std::string& s) { int n=MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,s.data(),(int)s.size(),nullptr,0); if(!n && !s.empty())throw std::runtime_error("Invalid UTF-8"); std::wstring w(n,0); MultiByteToWideChar(CP_UTF8,0,s.data(),(int)s.size(),w.data(),n); return w; }
inline std::string utf8(const std::wstring& w) { int n=WideCharToMultiByte(CP_UTF8,0,w.data(),(int)w.size(),nullptr,0,nullptr,nullptr); std::string s(n,0); WideCharToMultiByte(CP_UTF8,0,w.data(),(int)w.size(),s.data(),n,nullptr,nullptr);return s; }
inline std::wstring longpath(const std::string& s) {auto w=wide(s);if(w.rfind(L"\\\\?\\",0)==0)return w;if(w.rfind(L"\\\\",0)==0)return L"\\\\?\\UNC\\"+w.substr(2);if(w.size()<3||w[1]!=L':')throw std::runtime_error("Absolute local path required");return L"\\\\?\\"+w;}
inline void wincheck(bool ok,const char* message) {if(!ok)throw std::runtime_error(std::string(message)+" (Windows "+std::to_string(GetLastError())+")");}
struct Handle {HANDLE h=INVALID_HANDLE_VALUE; Handle(){} explicit Handle(HANDLE v):h(v){} ~Handle(){if(h!=INVALID_HANDLE_VALUE)CloseHandle(h);} Handle(const Handle&)=delete;Handle&operator=(const Handle&)=delete;Handle(Handle&&o):h(o.h){o.h=INVALID_HANDLE_VALUE;} };
inline uint64_t number(DWORD hi,DWORD lo){return (uint64_t(hi)<<32)|lo;}
inline std::string identity(HANDLE h) {BY_HANDLE_FILE_INFORMATION i{};wincheck(GetFileInformationByHandle(h,&i),"Read identity");return std::to_string(i.dwVolumeSerialNumber)+":"+std::to_string(number(i.nFileIndexHigh,i.nFileIndexLow))+":"+std::to_string(number(i.ftCreationTime.dwHighDateTime,i.ftCreationTime.dwLowDateTime));}
inline HANDLE openFile(const std::string& p,DWORD access=FILE_READ_ATTRIBUTES,DWORD sharing=FILE_SHARE_READ|FILE_SHARE_WRITE|FILE_SHARE_DELETE){HANDLE h=CreateFileW(longpath(p).c_str(),access,sharing,nullptr,OPEN_EXISTING,FILE_FLAG_BACKUP_SEMANTICS|FILE_FLAG_OPEN_REPARSE_POINT,nullptr);wincheck(h!=INVALID_HANDLE_VALUE,"Open file");return h;}
inline json fileInfo(const std::string&p){Handle h(openFile(p));BY_HANDLE_FILE_INFORMATION i{};wincheck(GetFileInformationByHandle(h.h,&i),"File information");return {{"identity",identity(h.h)},{"size",number(i.nFileSizeHigh,i.nFileSizeLow)},{"mtime",double(number(i.ftLastWriteTime.dwHighDateTime,i.ftLastWriteTime.dwLowDateTime)/10000)-11644473600000.0},{"attributes",i.dwFileAttributes},{"directory",bool(i.dwFileAttributes&FILE_ATTRIBUTE_DIRECTORY)},{"hidden",bool(i.dwFileAttributes&(FILE_ATTRIBUTE_HIDDEN|FILE_ATTRIBUTE_SYSTEM))},{"reparse",bool(i.dwFileAttributes&FILE_ATTRIBUTE_REPARSE_POINT)}};}
template<class F>int serve(F handler){std::string line;while(std::getline(std::cin,line)){json id=nullptr;try{if(line.size()>1048576)throw std::runtime_error("Request too large");auto req=json::parse(line);id=req.at("id");auto result=handler(req);std::cout<<json{{"id",id},{"result",result}}.dump()<<std::endl;}catch(const std::exception&e){std::cout<<json{{"id",id},{"error",e.what()}}.dump()<<std::endl;}}return 0;}
