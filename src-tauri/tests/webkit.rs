//! Tests of `src/webkit.rs`: when the shell turns WebKitGTK's DMA-BUF renderer off.

use std::ffi::OsString;

use mockup_director_lib::webkit::{dmabuf_renderer, DmabufRenderer};

#[test]
fn turns_the_renderer_off_when_the_user_has_not_chosen() {
    assert_eq!(dmabuf_renderer(None), DmabufRenderer::TurnOff);
}

#[test]
fn leaves_any_value_the_user_set() {
    for value in ["0", "1", "", "yes"] {
        assert_eq!(
            dmabuf_renderer(Some(OsString::from(value))),
            DmabufRenderer::UserChoice(OsString::from(value)),
            "{value:?}"
        );
    }
}
