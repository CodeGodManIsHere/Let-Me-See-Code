#import <UIKit/UIKit.h>
#import <Foundation/Foundation.h>
#import <objc/runtime.h>

static const void *FKDWindowMarkerKey = &FKDWindowMarkerKey;

@interface FKDKeyboardDismissor : NSObject
+ (instancetype)shared;
- (void)installOnCurrentWindows;
@end

@implementation FKDKeyboardDismissor

+ (instancetype)shared {
    static FKDKeyboardDismissor *instance;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        instance = [FKDKeyboardDismissor new];
    });
    return instance;
}

- (instancetype)init {
    self = [super init];
    if (!self) return nil;

    NSNotificationCenter *nc = NSNotificationCenter.defaultCenter;
    [nc addObserver:self
           selector:@selector(windowStateChanged:)
               name:UIApplicationDidBecomeActiveNotification
             object:nil];
    [nc addObserver:self
           selector:@selector(windowStateChanged:)
               name:UIWindowDidBecomeVisibleNotification
             object:nil];

    dispatch_async(dispatch_get_main_queue(), ^{
        [self installOnCurrentWindows];
    });

    return self;
}

- (void)windowStateChanged:(NSNotification *)notification {
    (void)notification;
    dispatch_async(dispatch_get_main_queue(), ^{
        [self installOnCurrentWindows];
    });
}

- (NSArray<UIWindow *> *)allWindows {
    NSMutableOrderedSet<UIWindow *> *result = [NSMutableOrderedSet orderedSet];

    UIApplication *app = UIApplication.sharedApplication;

    if (@available(iOS 13.0, *)) {
        for (UIScene *scene in app.connectedScenes) {
            if (![scene isKindOfClass:UIWindowScene.class]) continue;
            UIWindowScene *windowScene = (UIWindowScene *)scene;
            for (UIWindow *window in windowScene.windows) {
                if (window) [result addObject:window];
            }
        }
    }

#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
    for (UIWindow *window in app.windows) {
        if (window) [result addObject:window];
    }
#pragma clang diagnostic pop

    return result.array;
}

- (void)forceDismissKeyboard {
    void (^dismissBlock)(void) = ^{
        UIApplication *app = UIApplication.sharedApplication;

        for (UIWindow *window in [self allWindows]) {
            [window endEditing:YES];
            [window.rootViewController.view endEditing:YES];
        }

        [app sendAction:@selector(resignFirstResponder)
                     to:nil
                   from:nil
               forEvent:nil];
    };

    dismissBlock();

    // Retry briefly because LiveContainer/SDL can leave the software keyboard
    // attached for a moment after Source hides the console.
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.05 * NSEC_PER_SEC)),
                   dispatch_get_main_queue(), dismissBlock);
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.18 * NSEC_PER_SEC)),
                   dispatch_get_main_queue(), dismissBlock);
}

- (void)consoleCornerTap:(UITapGestureRecognizer *)gesture {
    if (gesture.state != UIGestureRecognizerStateEnded) return;

    UIView *view = gesture.view;
    if (!view) return;

    CGPoint point = [gesture locationInView:view];
    CGRect bounds = view.bounds;
    if (CGRectIsEmpty(bounds)) return;

    // Source's console close control is in the upper-right. This invisible
    // helper lets the original tap continue while also forcing UIKit to
    // release any stale keyboard first responder.
    const CGFloat rightEdge = CGRectGetWidth(bounds) * 0.78;
    const CGFloat topEdge = CGRectGetHeight(bounds) * 0.28;

    if (point.x >= rightEdge && point.y <= topEdge) {
        [self forceDismissKeyboard];
    }
}

- (void)emergencyDismissTap:(UITapGestureRecognizer *)gesture {
    if (gesture.state == UIGestureRecognizerStateEnded) {
        [self forceDismissKeyboard];
    }
}

- (void)installOnWindow:(UIWindow *)window {
    if (!window) return;
    if (objc_getAssociatedObject(window, FKDWindowMarkerKey)) return;

    objc_setAssociatedObject(window,
                             FKDWindowMarkerKey,
                             @YES,
                             OBJC_ASSOCIATION_RETAIN_NONATOMIC);

    UITapGestureRecognizer *cornerTap =
        [[UITapGestureRecognizer alloc] initWithTarget:self
                                                action:@selector(consoleCornerTap:)];
    cornerTap.numberOfTouchesRequired = 1;
    cornerTap.numberOfTapsRequired = 1;
    cornerTap.cancelsTouchesInView = NO;
    cornerTap.delaysTouchesBegan = NO;
    cornerTap.delaysTouchesEnded = NO;
    [window addGestureRecognizer:cornerTap];

    // Invisible fallback: two-finger double-tap anywhere.
    UITapGestureRecognizer *fallback =
        [[UITapGestureRecognizer alloc] initWithTarget:self
                                                action:@selector(emergencyDismissTap:)];
    fallback.numberOfTouchesRequired = 2;
    fallback.numberOfTapsRequired = 2;
    fallback.cancelsTouchesInView = NO;
    fallback.delaysTouchesBegan = NO;
    fallback.delaysTouchesEnded = NO;
    [window addGestureRecognizer:fallback];
}

- (void)installOnCurrentWindows {
    for (UIWindow *window in [self allWindows]) {
        [self installOnWindow:window];
    }
}

- (void)dealloc {
    [NSNotificationCenter.defaultCenter removeObserver:self];
}

@end

__attribute__((constructor))
static void ForceKeyboardDismissInit(void) {
    @autoreleasepool {
        dispatch_async(dispatch_get_main_queue(), ^{
            (void)[FKDKeyboardDismissor shared];
        });
    }
}
