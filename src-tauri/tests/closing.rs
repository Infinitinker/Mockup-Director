//! Tests of `src/closing.rs`: the close watchdog starts once, however often the user clicks close.

use mockup_director_lib::closing::{CloseWatchdog, CLOSE_TIMEOUT};

#[test]
fn arms_only_on_the_first_close_request() {
    let watchdog = CloseWatchdog::default();
    assert!(watchdog.arm());
    assert!(!watchdog.arm());
    assert!(!watchdog.arm());
}

#[test]
fn waits_longer_than_the_page_waits_for_its_save() {
    // FLUSH_TIMEOUT_MS in src/platform/window.ts.
    assert!(CLOSE_TIMEOUT.as_millis() > 2000);
}
