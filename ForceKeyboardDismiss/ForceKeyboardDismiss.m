#import <UIKit/UIKit.h>
#import <Foundation/Foundation.h>
#import <objc/runtime.h>
#import <dlfcn.h>
#import <mach-o/dyld.h>

static volatile BOOL FKDKeyboardVisible = NO;
static void (*FKDSDLStopTextInput)(void) = NULL;

static void FKDResolveSDLStopTextInput(void) {
    if (FKDSDLStopTextInput) return;

    void *sym = dlsym(RTLD_DEFAULT, "SDL_StopTextInput");
    if (sym) {
        FKDSDLStopTextInput = (void (*)(void))sym;
        return;
    }

    uint32_t count = _dyld_image_count();
    for (uint32_t i = 0; i < count; i++) {
        const char *name = _dyld_get_image_name(i);
        if (!name) continue;

        void *handle = dlopen(name, RTLD_LAZY | RTLD_NOLOAD);
        if (!handle) continue;

        sym = dlsym(handle, "SDL_StopTextInput");
        dlclose(handle);

        if (sym) {
            FKDSDLStopTextInput = (void (*)(void))sym;
            return;
        }
    }
}

static NSArray<UIWindow *> *FKDAllWindows(void) {
    NSMutableOrderedSet<UIWindow *> *windows = [NSMutableOrderedSet orderedSet];
    UIApplication *app = UIApplication.sharedApplication;

    if (@available(iOS 13.0, *)) {
        for (UIScene *scene in app.connectedScenes) {
            if (![scene isKindOfClass:UIWindowScene.class]) continue;
            UIWindowScene *windowScene = (UIWindowScene *)scene;
            for (UIWindow *window in windowScene.windows) {
                if (window) [windows addObject:window];
            }
        }
    }

#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
    for (UIWindow *window in app.windows) {
        if (window) [windows addObject:window];
    }
#pragma clang diagnostic pop

    return windows.array;
}

static void FKDForceDismissKeyboard(void) {
    dispatch_async(dispatch_get_main_queue(), ^{
        FKDResolveSDLStopTextInput();

        void (^dismissOnce)(void) = ^{
            if (FKDSDLStopTextInput) {
                FKDSDLStopTextInput();
            }

            UIApplication *app = UIApplication.sharedApplication;

            for (UIWindow *window in FKDAllWindows()) {
                [window endEditing:YES];
                [window.rootViewController.view endEditing:YES];
            }

            [app sendAction:@selector(resignFirstResponder)
                         to:nil
                       from:nil
                   forEvent:nil];
        };

        dismissOnce();

        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.05 * NSEC_PER_SEC)),
                       dispatch_get_main_queue(), dismissOnce);
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.18 * NSEC_PER_SEC)),
                       dispatch_get_main_queue(), dismissOnce);
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.40 * NSEC_PER_SEC)),
                       dispatch_get_main_queue(), dismissOnce);
    });
}

@interface FKDKeyboardObserver : NSObject
+ (instancetype)shared;
@end

@implementation FKDKeyboardObserver

+ (instancetype)shared {
    static FKDKeyboardObserver *instance;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        instance = [FKDKeyboardObserver new];
    });
    return instance;
}

- (instancetype)init {
    self = [super init];
    if (!self) return nil;

    NSNotificationCenter *nc = NSNotificationCenter.defaultCenter;

    [nc addObserverForName:UIKeyboardWillShowNotification
                    object:nil
                     queue:NSOperationQueue.mainQueue
                usingBlock:^(__unused NSNotification *note) {
        FKDKeyboardVisible = YES;
        FKDResolveSDLStopTextInput();
    }];

    [nc addObserverForName:UIKeyboardDidShowNotification
                    object:nil
                     queue:NSOperationQueue.mainQueue
                usingBlock:^(__unused NSNotification *note) {
        FKDKeyboardVisible = YES;
        FKDResolveSDLStopTextInput();
    }];

    [nc addObserverForName:UIKeyboardDidHideNotification
                    object:nil
                     queue:NSOperationQueue.mainQueue
                usingBlock:^(__unused NSNotification *note) {
        FKDKeyboardVisible = NO;
    }];

    return self;
}

@end

@interface UIApplication (FKDKeyboardDismiss)
- (void)fkd_sendEvent:(UIEvent *)event;
@end

@implementation UIApplication (FKDKeyboardDismiss)

- (void)fkd_sendEvent:(UIEvent *)event {
    [self fkd_sendEvent:event];

    if (event.type != UIEventTypeTouches) return;

    NSSet<UITouch *> *touches = event.allTouches;
    if (touches.count == 0) return;

    NSUInteger endedDoubleTaps = 0;
    BOOL topRightEndedTap = NO;

    for (UITouch *touch in touches) {
        if (touch.phase != UITouchPhaseEnded) continue;

        if (touch.tapCount >= 2) {
            endedDoubleTaps++;
        }

        UIWindow *window = touch.window;
        if (!window) continue;

        CGPoint p = [touch locationInView:window];
        CGRect b = window.bounds;

        if (!CGRectIsEmpty(b) &&
            p.x >= CGRectGetWidth(b) * 0.78 &&
            p.y <= CGRectGetHeight(b) * 0.25) {
            topRightEndedTap = YES;
        }
    }

    // Invisible emergency trigger: two-finger double-tap anywhere.
    if (touches.count >= 2 && endedDoubleTaps >= 2) {
        FKDForceDismissKeyboard();
        return;
    }

    // Source Engine's VGUI console close button sits in the upper-right.
    // Only act while the software keyboard is actually visible.
    if (FKDKeyboardVisible && topRightEndedTap) {
        FKDForceDismissKeyboard();
    }
}

@end

static void FKDInstallSendEventHook(void) {
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        Class cls = UIApplication.class;
        Method original = class_getInstanceMethod(cls, @selector(sendEvent:));
        Method replacement = class_getInstanceMethod(cls, @selector(fkd_sendEvent:));

        if (original && replacement) {
            method_exchangeImplementations(original, replacement);
        }
    });
}

__attribute__((constructor))
static void ForceKeyboardDismissInit(void) {
    @autoreleasepool {
        FKDInstallSendEventHook();

        dispatch_async(dispatch_get_main_queue(), ^{
            (void)[FKDKeyboardObserver shared];
            FKDResolveSDLStopTextInput();
        });
    }
}
