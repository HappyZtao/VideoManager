#include "../protocol/common.hpp"
#include <deque>
#include <memory>
#include <cmath>
#include <chrono>
extern "C" {
#include <libavformat/avformat.h>
#include <libavcodec/avcodec.h>
#include <libavutil/imgutils.h>
#include <libavutil/display.h>
#include <libswscale/swscale.h>
}
void avcheck(int result,const char* action){if(result<0){char message[AV_ERROR_MAX_STRING_SIZE];av_strerror(result,message,sizeof(message));throw std::runtime_error(std::string(action)+": "+message);}}
int inputRead(void* opaque,uint8_t* buffer,int size){DWORD n=0;if(!ReadFile((HANDLE)opaque,buffer,size,&n,nullptr))return AVERROR(EIO);return n?int(n):AVERROR_EOF;}
int64_t inputSeek(void*opaque,int64_t offset,int whence){HANDLE h=(HANDLE)opaque;LARGE_INTEGER size{},pos{},out{};if(whence==AVSEEK_SIZE){if(!GetFileSizeEx(h,&size))return AVERROR(EIO);return size.QuadPart;}pos.QuadPart=offset;if(!SetFilePointerEx(h,pos,&out,whence&~AVSEEK_FORCE))return AVERROR(EIO);return out.QuadPart;}
int denyOpen(AVFormatContext*,AVIOContext**,const char*,int,AVDictionary**){return AVERROR(EACCES);}
struct Picture {AVFrame* frame=nullptr;int64_t pts=0;double time=0;int ordinal=0;Picture(AVFrame*f,int64_t p,double t,int o):frame(av_frame_clone(f)),pts(p),time(t),ordinal(o){}~Picture(){av_frame_free(&frame);}};
struct Decoder {
 Handle input;AVIOContext*io=nullptr;AVFormatContext*format=nullptr;AVCodecContext*codec=nullptr;AVPacket*packet=nullptr;AVFrame*frame=nullptr;int stream=-1;AVRational base{};int64_t start=0;double duration=0,rotation=0;int selected=-1,sequence=0;bool flushed=false;std::deque<std::shared_ptr<Picture>> window;
 Decoder(const std::string&path):input(openFile(path,GENERIC_READ,FILE_SHARE_READ)){
  auto inf=fileInfo(path);if(inf["reparse"].get<bool>())throw std::runtime_error("Linked media is not allowed");
  format=avformat_alloc_context();io=avio_alloc_context((unsigned char*)av_malloc(65536),65536,0,(void*)input.h,inputRead,nullptr,inputSeek);if(!format||!io)throw std::runtime_error("Decoder allocation failed");format->pb=io;format->flags|=AVFMT_FLAG_CUSTOM_IO;format->io_open=denyOpen;
  AVDictionary* options=nullptr;av_dict_set(&options,"protocol_whitelist","",0);av_dict_set(&options,"max_pixels","60000000",0);av_dict_set(&options,"probesize","8388608",0);int opened=avformat_open_input(&format,nullptr,nullptr,&options);av_dict_free(&options);avcheck(opened,"Open media");avcheck(avformat_find_stream_info(format,nullptr),"Probe media");
  stream=av_find_best_stream(format,AVMEDIA_TYPE_VIDEO,-1,-1,nullptr,0);avcheck(stream,"No video stream");auto s=format->streams[stream];base=s->time_base;start=s->start_time==AV_NOPTS_VALUE?0:s->start_time;duration=s->duration!=AV_NOPTS_VALUE?s->duration*av_q2d(base):(format->duration!=AV_NOPTS_VALUE?double(format->duration)/AV_TIME_BASE:0);
  if(s->codecpar->width<=0||s->codecpar->height<=0||int64_t(s->codecpar->width)*s->codecpar->height>60000000)throw std::runtime_error("Media dimensions exceed limit");
  size_t sideSize=0;const auto matrix=av_packet_side_data_get(s->codecpar->coded_side_data,s->codecpar->nb_coded_side_data,AV_PKT_DATA_DISPLAYMATRIX);if(matrix&&matrix->size>=9*sizeof(int32_t))rotation=-av_display_rotation_get((const int32_t*)matrix->data);
  const auto decoder=avcodec_find_decoder(s->codecpar->codec_id);if(!decoder)throw std::runtime_error("Unsupported codec");codec=avcodec_alloc_context3(decoder);avcheck(avcodec_parameters_to_context(codec,s->codecpar),"Codec parameters");codec->thread_count=2;avcheck(avcodec_open2(codec,decoder,nullptr),"Open decoder");packet=av_packet_alloc();frame=av_frame_alloc();
 }
 ~Decoder(){window.clear();av_frame_free(&frame);av_packet_free(&packet);avcodec_free_context(&codec);avformat_close_input(&format);if(io){av_freep(&io->buffer);avio_context_free(&io);}}
 std::shared_ptr<Picture> next(){
  for(;;){int code=avcodec_receive_frame(codec,frame);if(code==0){auto pts=frame->best_effort_timestamp;if(pts==AV_NOPTS_VALUE)throw std::runtime_error("No reliable presentation timestamp");auto p=std::make_shared<Picture>(frame,pts,(pts-start)*av_q2d(base),sequence++);av_frame_unref(frame);return p;}if(code==AVERROR_EOF)return nullptr;if(code!=AVERROR(EAGAIN))avcheck(code,"Decode frame");
   if(flushed)return nullptr;bool sent=false;while(av_read_frame(format,packet)>=0){if(packet->stream_index==stream){int result=avcodec_send_packet(codec,packet);av_packet_unref(packet);avcheck(result,"Send packet");sent=true;break;}av_packet_unref(packet);}if(!sent){avcheck(avcodec_send_packet(codec,nullptr),"Drain decoder");flushed=true;}
  }
 }
 void append(std::shared_ptr<Picture>p){window.push_back(std::move(p));while(window.size()>12||window.size()*int64_t(codec->width)*codec->height*4>96*1024*1024){if(window.size()<=2)break;window.pop_front();selected--;}}
 void reset(double time){int64_t pts=start+int64_t(std::max(0.0,time)/av_q2d(base));avcheck(av_seek_frame(format,stream,pts,AVSEEK_FLAG_BACKWARD),"Seek keyframe");avcodec_flush_buffers(codec);flushed=false;sequence=0;window.clear();selected=-1;}
 std::shared_ptr<Picture> seek(double time){reset(time);auto begin=std::chrono::steady_clock::now();while(auto p=next()){append(p);selected=int(window.size())-1;if(p->time>time && window.size()>1){selected--;break;}if(p->time>=time)break;if(std::chrono::steady_clock::now()-begin>std::chrono::seconds(15))throw std::runtime_error("Frame seek timed out");}if(window.empty())throw std::runtime_error("No decoded frame");if(selected<0)selected=0;return window.at(selected);}
 std::shared_ptr<Picture> step(int direction,double time){if(window.empty()||selected<0||selected>=int(window.size())||std::abs(window.at(selected)->time-time)>std::max(0.000001,av_q2d(base)*0.5))seek(time);if(direction>0){if(selected+1<int(window.size()))return window.at(++selected);auto p=next();if(!p)throw std::runtime_error("Already at last frame");append(p);selected=int(window.size())-1;return p;}if(selected>0)return window.at(--selected);
  auto current=window.at(selected);for(double back=2;back<=64;back*=2){reset(std::max(0.0,current->time-back));while(auto p=next()){append(p);if(p->pts>=current->pts){if(window.size()>1){selected=int(window.size())-2;return window.at(selected);}break;}}if(current->time-back<=0)break;}throw std::runtime_error("Already at first frame or previous frame unavailable");
 }
 json describe(){auto s=format->streams[stream];return {{"duration",duration},{"width",codec->width},{"height",codec->height},{"codec",avcodec_get_name(codec->codec_id)},{"rotation",rotation},{"timeBaseNum",base.num},{"timeBaseDen",base.den},{"identity",identity(input.h)}};}
 json save(std::shared_ptr<Picture>p,const std::string&path){
  auto sar=p->frame->sample_aspect_ratio;double ratio=sar.num>0&&sar.den>0?av_q2d(sar):1.0;int w=int(std::round(p->frame->width*ratio)),h=p->frame->height;if(w<=0||int64_t(w)*h>60000000)throw std::runtime_error("Frame dimensions exceed limit");
  AVFrame*rgb=av_frame_alloc();rgb->format=AV_PIX_FMT_RGB24;rgb->width=w;rgb->height=h;avcheck(av_frame_get_buffer(rgb,32),"Frame buffer");auto sws=sws_getContext(p->frame->width,p->frame->height,(AVPixelFormat)p->frame->format,w,h,AV_PIX_FMT_RGB24,SWS_BICUBIC,nullptr,nullptr,nullptr);if(!sws){av_frame_free(&rgb);throw std::runtime_error("Unsupported color conversion");}sws_scale(sws,p->frame->data,p->frame->linesize,0,p->frame->height,rgb->data,rgb->linesize);sws_freeContext(sws);
  auto encoder=avcodec_find_encoder(AV_CODEC_ID_PNG);auto enc=avcodec_alloc_context3(encoder);enc->width=w;enc->height=h;enc->pix_fmt=AV_PIX_FMT_RGB24;enc->time_base={1,1};enc->thread_count=1;avcheck(avcodec_open2(enc,encoder,nullptr),"PNG encoder");auto out=av_packet_alloc();avcheck(avcodec_send_frame(enc,rgb),"Encode snapshot");avcheck(avcodec_receive_packet(enc,out),"Receive snapshot");
  Handle file(CreateFileW(longpath(path).c_str(),GENERIC_WRITE,0,nullptr,CREATE_NEW,FILE_ATTRIBUTE_NORMAL,nullptr));wincheck(file.h!=INVALID_HANDLE_VALUE,"Create snapshot");DWORD written=0;wincheck(WriteFile(file.h,out->data,out->size,&written,nullptr)&&written==DWORD(out->size),"Write snapshot");wincheck(FlushFileBuffers(file.h),"Flush snapshot");av_packet_free(&out);avcodec_free_context(&enc);av_frame_free(&rgb);
  return {{"time",p->time},{"pts",std::to_string(p->pts)},{"ordinal",p->ordinal},{"width",w},{"height",h},{"duration",duration},{"rotation",rotation},{"timeBaseNum",base.num},{"timeBaseDen",base.den}};
 }
};
std::unique_ptr<Decoder> decoder;
json command(const json&r){auto method=r.at("method").get<std::string>();if(method=="open"){decoder=std::make_unique<Decoder>(r.at("path"));return decoder->describe();}if(method=="close"){decoder.reset();return true;}if(method=="version")return {{"ffmpeg",av_version_info()},{"configuration",avcodec_configuration()},{"license",avcodec_license()}};if(!decoder)throw std::runtime_error("No active decoder");if(method=="frame"){std::shared_ptr<Picture>p;int step=r.value("step",0);if(step)p=decoder->step(step,r.value("time",0.0));else p=decoder->seek(r.value("time",0.0));return decoder->save(p,r.at("output"));}throw std::runtime_error("Unknown media operation");}
int main(){SetErrorMode(SEM_FAILCRITICALERRORS|SEM_NOGPFAULTERRORBOX);av_log_set_level(AV_LOG_ERROR);return serve(command);}
