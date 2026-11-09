//! Keep WebView2's command implementations, but render their menu in trusted chrome.
use serde_json::{json, Value};
use std::{
    cell::{Cell, RefCell},
    collections::HashSet,
    rc::Rc,
};
use webview2_com::{
    take_pwstr, ContextMenuRequestedEventHandler, Microsoft::Web::WebView2::Win32::*,
};
use windows::{
    core::{Interface, PWSTR},
    Win32::Foundation::POINT,
};
use wry::{WebView, WebViewExtWindows};

struct Pending {
    token: u64,
    tab: u64,
    args: ICoreWebView2ContextMenuRequestedEventArgs,
    deferral: ICoreWebView2Deferral,
    commands: HashSet<i32>,
}
impl Drop for Pending {
    fn drop(&mut self) {
        unsafe {
            let _ = self.deferral.Complete();
        }
    }
}
#[derive(Default)]
pub struct Manager {
    pending: Rc<RefCell<Option<Pending>>>,
    next: Rc<Cell<u64>>,
}
impl Manager {
    pub fn attach(
        &self,
        view: &WebView,
        tab: u64,
        show: impl Fn(Value) + 'static,
    ) -> Result<(), String> {
        let pending = self.pending.clone();
        let next = self.next.clone();
        let handler = ContextMenuRequestedEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else { return Ok(()) };
            unsafe {
                let mut commands = HashSet::new();
                let items = menu_items(&args.MenuItems()?, &mut commands, 0)?;
                if items.is_empty() {
                    return Ok(());
                }
                let mut point = POINT::default();
                args.Location(&mut point)?;
                let deferral = args.GetDeferral()?;
                args.SetHandled(true)?;
                let token = next.get().saturating_add(1);
                next.set(token);
                // Complete the previous deferral before replacing it.
                pending.borrow_mut().take();
                *pending.borrow_mut() = Some(Pending {
                    token,
                    tab,
                    args,
                    deferral,
                    commands,
                });
                show(
                    json!({"token": token, "tab_id":tab, "x":point.x, "y":point.y, "items":items}),
                );
            }
            Ok(())
        }));
        unsafe {
            view.webview()
                .cast::<ICoreWebView2_11>()
                .and_then(|view| view.add_ContextMenuRequested(&handler, &mut 0))
                .map_err(|e| e.to_string())
        }
    }
    pub fn answer(&self, token: u64, command: Option<i32>) {
        if self
            .pending
            .borrow()
            .as_ref()
            .is_some_and(|p| p.token == token)
        {
            if let Some(pending) = self.pending.borrow_mut().take() {
                if let Some(command) = command.filter(|id| pending.commands.contains(id)) {
                    unsafe {
                        let _ = pending.args.SetSelectedCommandId(command);
                    }
                }
            }
        }
    }
    pub fn close_tab(&self, tab: u64) {
        if self.pending.borrow().as_ref().is_some_and(|p| p.tab == tab) {
            self.pending.borrow_mut().take();
        }
    }
}
unsafe fn menu_items(
    items: &ICoreWebView2ContextMenuItemCollection,
    commands: &mut HashSet<i32>,
    depth: u8,
) -> windows::core::Result<Vec<Value>> {
    if depth > 4 {
        return Ok(Vec::new());
    }
    let mut count = 0;
    items.Count(&mut count)?;
    let mut result = Vec::new();
    for index in 0..count.min(100) {
        let item = items.GetValueAtIndex(index)?;
        let (mut label, mut name, mut shortcut) = (PWSTR::null(), PWSTR::null(), PWSTR::null());
        item.Label(&mut label)?;
        item.Name(&mut name)?;
        item.ShortcutKeyDescription(&mut shortcut)?;
        let (label, name, shortcut) = (take_pwstr(label), take_pwstr(name), take_pwstr(shortcut));
        let mut id = 0;
        let mut kind = COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_COMMAND;
        let (mut enabled, mut checked) = (false.into(), false.into());
        item.CommandId(&mut id)?;
        item.Kind(&mut kind)?;
        item.IsEnabled(&mut enabled)?;
        item.IsChecked(&mut checked)?;
        let children = if kind == COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_SUBMENU {
            menu_items(&item.Children()?, commands, depth + 1)?
        } else {
            Vec::new()
        };
        if enabled.as_bool()
            && matches!(
                kind,
                COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_COMMAND
                    | COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_CHECK_BOX
                    | COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_RADIO
            )
        {
            commands.insert(id);
        }
        result.push(json!({"id":id, "name":name, "label":translated(&name, &label), "shortcut":shortcut, "enabled":enabled.as_bool(), "checked":checked.as_bool(), "separator":kind == COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_SEPARATOR, "children":children}));
    }
    Ok(result)
}
fn translated<'a>(name: &str, fallback: &'a str) -> &'a str {
    match name {
        "back" => "Voltar",
        "forward" => "Avançar",
        "reload" => "Recarregar",
        "openLinkInNewWindow" => "Abrir link em nova aba",
        "saveLinkAs" => "Salvar link como…",
        "copyLinkAddress" | "copyLink" => "Copiar endereço do link",
        "saveImageAs" => "Salvar imagem como…",
        "copyImage" => "Copiar imagem",
        "copyImageAddress" | "copyImageLocation" => "Copiar endereço da imagem",
        "copy" => "Copiar",
        "cut" => "Recortar",
        "paste" => "Colar",
        "selectAll" => "Selecionar tudo",
        "undo" => "Desfazer",
        "redo" => "Refazer",
        "inspect" | "inspectElement" => "Inspecionar elemento",
        "other" | "otherTools" | "moreTools" => "Mais ferramentas",
        "print" => "Imprimir…",
        _ => fallback,
    }
}
