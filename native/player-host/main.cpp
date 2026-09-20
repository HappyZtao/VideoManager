#include "../protocol/common.hpp"
#include <algorithm>

// The host owns a clipped child surface only; it never creates a top-level player.
HWND surface=nullptr,owner=nullptr;
// mpv disables its child HWND in --wid mode. Our owned surface must opt it
// back into native input so OSD mouse movement, clicks and capture can work.
void enablePlayerInput(){
 if(!surface)return;
 HWND player=FindWindowExW(surface,nullptr,L"mpv",nullptr);
 if(player&&!IsWindowEnabled(player))EnableWindow(player,TRUE);
}
LRESULT CALLBACK windowProc(HWND hwnd,UINT message,WPARAM w,LPARAM l){
 if(message==WM_MOUSEACTIVATE)return MA_NOACTIVATE;
 return DefWindowProcW(hwnd,message,w,l);
}
void bounds(const json&r){
 if(!surface||!IsWindow(owner))throw std::runtime_error("Player host unavailable");
 RECT client{};GetClientRect(owner,&client);
 int x=std::clamp(r.at("x").get<int>(),0,int(client.right)),y=std::clamp(r.at("y").get<int>(),0,int(client.bottom));
 int width=std::clamp(r.at("width").get<int>(),0,std::max(0,int(client.right)-x));
 int height=std::clamp(r.at("height").get<int>(),0,std::max(0,int(client.bottom)-y));
 enablePlayerInput();
 wincheck(SetWindowPos(surface,HWND_TOP,x,y,width,height,SWP_NOACTIVATE|((width&&height&&r.value("visible",true))?SWP_SHOWWINDOW:SWP_HIDEWINDOW)),"Position video surface");
}
json command(const json&r){
 auto method=r.at("method").get<std::string>();
 if(method=="create"){
  if(surface)throw std::runtime_error("Player surface already exists");
  owner=reinterpret_cast<HWND>(uintptr_t(r.at("parent").get<uint32_t>()));
  if(!IsWindow(owner))throw std::runtime_error("Invalid parent window");
  surface=CreateWindowExW(WS_EX_NOACTIVATE,L"VideoManagerMpvSurface",L"",WS_CHILD|WS_CLIPCHILDREN|WS_CLIPSIBLINGS,0,0,0,0,owner,nullptr,GetModuleHandleW(nullptr),nullptr);
  wincheck(surface!=nullptr,"Create video surface");bounds(r);
  return uint32_t(reinterpret_cast<uintptr_t>(surface));
 }
 if(method=="bounds"){bounds(r);return true;}
 throw std::runtime_error("Unknown player host command");
}
int main(){
 SetErrorMode(SEM_FAILCRITICALERRORS|SEM_NOGPFAULTERRORBOX);
 auto dpi=reinterpret_cast<BOOL(WINAPI*)(HANDLE)>(GetProcAddress(GetModuleHandleW(L"user32.dll"),"SetProcessDpiAwarenessContext"));
 if(dpi)dpi(reinterpret_cast<HANDLE>(-4));
 WNDCLASSW cls{};cls.lpfnWndProc=windowProc;cls.hInstance=GetModuleHandleW(nullptr);cls.lpszClassName=L"VideoManagerMpvSurface";cls.hbrBackground=(HBRUSH)GetStockObject(BLACK_BRUSH);RegisterClassW(&cls);
 ULONGLONG lastInputCheck=0;
 std::string buffer;HANDLE input=GetStdHandle(STD_INPUT_HANDLE);bool running=true;
 while(running){
  MSG msg;while(PeekMessageW(&msg,nullptr,0,0,PM_REMOVE)){if(msg.message==WM_QUIT)running=false;TranslateMessage(&msg);DispatchMessageW(&msg);}
  if(owner&&!IsWindow(owner))break;
  if(GetTickCount64()-lastInputCheck>=100){lastInputCheck=GetTickCount64();enablePlayerInput();}
  DWORD available=0;if(!PeekNamedPipe(input,nullptr,0,nullptr,&available,nullptr))break;
  if(!available){Sleep(8);continue;}
  char bytes[8192];DWORD read=0;if(!ReadFile(input,bytes,std::min(available,DWORD(sizeof(bytes))),&read,nullptr)||!read)break;
  buffer.append(bytes,read);if(buffer.size()>1048576)break;
  size_t newline;while((newline=buffer.find('\n'))!=std::string::npos){auto line=buffer.substr(0,newline);buffer.erase(0,newline+1);json id=nullptr;try{auto request=json::parse(line);id=request.at("id");auto result=command(request);std::cout<<json{{"id",id},{"result",result}}.dump()<<std::endl;}catch(const std::exception&e){std::cout<<json{{"id",id},{"error",e.what()}}.dump()<<std::endl;}}
 }
 if(surface&&IsWindow(surface))DestroyWindow(surface);
 return 0;
}
