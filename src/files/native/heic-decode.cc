// Crest's thin libheif/libde265 adapter. Dependency licenses/sources ship with it.
#include <libheif/heif.h>
#include <libde265/de265.h>
#include <png.h>
#include <cstdio>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <memory>
#include <vector>

constexpr uint64_t pixels=60000000, png_limit=256ULL*1024*1024;
void require(bool ok,const char* code="HEIC_DECODE_FAILED"){if(!ok)throw code;}
void checked(heif_error e){require(e.code==heif_error_Ok);}
void dimensions(int w,int h){require(w>0&&h>0&&uint64_t(w)*uint64_t(h)<=pixels,"HEIC_PIXEL_LIMIT");}
struct Output {FILE* file;uint64_t size;};
void png_failure(png_structp p,png_const_charp){png_longjmp(p,1);}
void png_warning(png_structp p,png_const_charp){png_error(p,"invalid");}
void png_write(png_structp p,png_bytep bytes,png_size_t size){
  auto* out=static_cast<Output*>(png_get_io_ptr(p));
  if(size>png_limit-out->size||fwrite(bytes,1,size,out->file)!=size){png_error(p,"output");}
  out->size+=size;
}
void write_png(const char* path,int width,int height,const uint8_t* data,size_t stride,const std::vector<uint8_t>& icc){
  FILE* file=fopen(path,"wbx");require(file!=nullptr);
  png_structp p=png_create_write_struct(PNG_LIBPNG_VER_STRING,nullptr,png_failure,png_warning);
  if(!p){fclose(file);throw "HEIC_DECODE_FAILED";}
  png_infop info=png_create_info_struct(p);
  if(!info){png_destroy_write_struct(&p,nullptr);fclose(file);throw "HEIC_DECODE_FAILED";}
  Output out{file,0};
  if(setjmp(png_jmpbuf(p))){png_destroy_write_struct(&p,&info);fclose(file);throw "HEIC_DECODE_FAILED";}
  png_set_write_fn(p,&out,png_write,nullptr);png_set_compression_level(p,1);
  png_set_IHDR(p,info,width,height,8,PNG_COLOR_TYPE_RGBA,PNG_INTERLACE_NONE,PNG_COMPRESSION_TYPE_DEFAULT,PNG_FILTER_TYPE_DEFAULT);
  if(!icc.empty())png_set_iCCP(p,info,"source",PNG_COMPRESSION_TYPE_BASE,icc.data(),icc.size());
  else png_set_sRGB(p,info,PNG_sRGB_INTENT_PERCEPTUAL);
  png_write_info(p,info);
  for(int y=0;y<height;y++)png_write_row(p,const_cast<png_bytep>(data+size_t(y)*stride));
  png_write_end(p,info);png_destroy_write_struct(&p,&info);require(fclose(file)==0);
}
int main(int argc,char** argv){
  try{
    require(std::strcmp(heif_get_version(),"1.23.6")==0&&std::strcmp(de265_get_version(),"1.1.3")==0,"HEIC_TOOLS_UNAVAILABLE");
    if(argc==2&&std::strcmp(argv[1],"--version")==0){std::cout<<"crest-heic-v1 libheif1.23.6 libde2651.1.3\n";return 0;}
    require(argc==3);checked(heif_init(nullptr));
    const auto release=[](heif_context* c){heif_context_free(c);heif_deinit();};
    std::unique_ptr<heif_context,decltype(release)> context(heif_context_alloc(),release);require(bool(context));
    auto* limits=heif_context_get_security_limits(context.get());require(limits&&limits->version>=4);
    limits->max_image_size_pixels=pixels;limits->max_number_of_tiles=1024;limits->max_items=4096;
    limits->max_color_profile_size=4*1024*1024;limits->max_memory_block_size=256ULL*1024*1024;
    limits->max_total_memory=512ULL*1024*1024;limits->max_sequence_frames=1;limits->max_number_of_file_brands=64;
    heif_context_set_max_decoding_threads(context.get(),0);
    require(heif_get_decoder_descriptors(heif_compression_undefined,nullptr,0)==1&&heif_have_decoder_for_format(heif_compression_HEVC)
      &&!heif_have_encoder_for_format(heif_compression_HEVC),"HEIC_TOOLS_UNAVAILABLE");
    checked(heif_context_read_from_file(context.get(),argv[1],nullptr));
    require(!heif_context_has_sequence(context.get())&&heif_context_get_number_of_top_level_images(context.get())==1,"HEIC_FORMAT_UNAVAILABLE");
    heif_image_handle* h=nullptr;checked(heif_context_get_primary_image_handle(context.get(),&h));
    std::unique_ptr<heif_image_handle,decltype(&heif_image_handle_release)> handle(h,heif_image_handle_release);
    const int w=heif_image_handle_get_width(h),height=heif_image_handle_get_height(h),
      encoded_w=heif_image_handle_get_ispe_width(h),encoded_h=heif_image_handle_get_ispe_height(h),depth=heif_image_handle_get_luma_bits_per_pixel(h);
    dimensions(w,height);dimensions(encoded_w,encoded_h);require(depth>=8&&depth<=16,"HEIC_FORMAT_UNAVAILABLE");
    const size_t icc_size=heif_image_handle_get_raw_color_profile_size(h);require(icc_size<=4*1024*1024);
    std::vector<uint8_t> icc(icc_size);
    if(!icc.empty())checked(heif_image_handle_get_raw_color_profile(h,icc.data()));
    std::unique_ptr<heif_decoding_options,decltype(&heif_decoding_options_free)> options(heif_decoding_options_alloc(),heif_decoding_options_free);require(bool(options)&&options->version>=10);
    options->strict_decoding=1;options->autocorrect_broken_input=0;options->ignore_transformations=0;options->convert_hdr_to_8bit=1;
    options->num_codec_threads=1;options->num_library_threads=1;options->output_image_nclx_profile_passthrough=icc.empty()?0:1;
    heif_image* raw=nullptr;checked(heif_decode_image(h,&raw,heif_colorspace_RGB,heif_chroma_interleaved_RGBA,options.get()));
    std::unique_ptr<heif_image,decltype(&heif_image_release)> image(raw,heif_image_release);
    require(heif_image_get_decoding_warnings(raw,0,nullptr,0)==0);
    require(heif_image_get_primary_width(raw)==w&&heif_image_get_primary_height(raw)==height);
    require(heif_image_get_width(raw,heif_channel_interleaved)==w&&heif_image_get_height(raw,heif_channel_interleaved)==height);
    require(heif_image_get_bits_per_pixel_range(raw,heif_channel_interleaved)==8&&heif_image_get_bits_per_pixel(raw,heif_channel_interleaved)==32);
    size_t stride=0;const uint8_t* data=heif_image_get_plane_readonly2(raw,heif_channel_interleaved,&stride);
    require(data&&stride>=size_t(w)*4&&stride<=png_limit/size_t(height));
    // Consume every decoded pixel. Intermediate PNG carries only the color
    // profile required for sRGB conversion; original EXIF is never copied.
    write_png(argv[2],w,height,data,stride,icc);
    std::cout<<"{\"width\":"<<w<<",\"height\":"<<height<<",\"encodedWidth\":"<<encoded_w
      <<",\"encodedHeight\":"<<encoded_h<<",\"bitDepth\":"<<depth<<"}\n";return 0;
  }catch(const char* code){std::cout<<"{\"code\":\""<<code<<"\"}\n";return 1;}
  catch(...){std::cout<<"{\"code\":\"HEIC_DECODE_FAILED\"}\n";return 1;}
}
