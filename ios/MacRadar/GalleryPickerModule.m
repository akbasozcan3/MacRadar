#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(GalleryPickerModule, NSObject)

RCT_EXTERN_METHOD(pickMedia:(NSString *)mediaType
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(createVideoThumbnail:(NSString *)uriString
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
