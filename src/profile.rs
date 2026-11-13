use std::{ffi::OsString, path::PathBuf};

/// Never infer a shared profile from the presence of another drive.
pub fn directory(
    override_path: Option<OsString>,
    local_app_data: Option<OsString>,
    user_home: Option<OsString>,
) -> PathBuf {
    let nonempty = |value: &OsString| !value.is_empty();
    if let Some(path) = override_path.filter(nonempty) {
        return PathBuf::from(path);
    }
    let base = local_app_data.filter(nonempty).map(PathBuf::from).or_else(|| {
        user_home.filter(nonempty).map(|home| {
            PathBuf::from(home).join("AppData").join("Local")
        })
    }).expect("Não foi possível identificar o perfil do usuário. Defina LOCALAPPDATA ou MARE_DATA_DIR.");
    base.join("MareBrowser").join("User Data")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn different_users_and_windows_installations_keep_separate_profiles() {
        let first = directory(None, Some("C:/Users/one/AppData/Local".into()), None);
        let second = directory(None, Some("E:/Users/one/AppData/Local".into()), None);
        let other = directory(None, Some("C:/Users/two/AppData/Local".into()), None);
        assert_ne!(first, second);
        assert_ne!(first, other);
        assert_eq!(
            first,
            PathBuf::from("C:/Users/one/AppData/Local/MareBrowser/User Data")
        );
    }

    #[test]
    fn explicit_location_is_preserved_and_empty_environment_is_ignored() {
        assert_eq!(
            directory(Some("X:/Private".into()), None, None),
            PathBuf::from("X:/Private")
        );
        assert_eq!(
            directory(
                Some("".into()),
                Some("".into()),
                Some("C:/Users/one".into())
            ),
            PathBuf::from("C:/Users/one/AppData/Local/MareBrowser/User Data")
        );
    }
}
