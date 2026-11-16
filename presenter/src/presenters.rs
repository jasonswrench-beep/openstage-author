// SPDX-License-Identifier: Apache-2.0
//! The illustrated presenters of the Lite kind. Each is described by data (colours, a hair style, glasses), not by a picture file: the editor draws
//! them from that description, so a new presenter is a new entry here and nothing in the editor changes. The artwork is made for this project and
//! is released under the same licence as the program (Apache 2.0).

use serde_json::{json, Value};

pub fn list() -> Value {
    json!([
        {
            "id": "lite-guide", "name": "Guide", "tier": "lite",
            "description": "An illustrated guide with short dark hair and a teal shirt, facing the camera",
            "look": { "skin": "#e6b995", "hair": { "style": "short", "color": "#2b2118" }, "shirt": "#1f7a8c", "background": "#dcecf3", "glasses": false, "eyes": "#2b2118" }
        },
        {
            "id": "lite-coach", "name": "Coach", "tier": "lite",
            "description": "An illustrated coach with dark curly hair and an orange shirt, facing the camera",
            "look": { "skin": "#8d5a3b", "hair": { "style": "curly", "color": "#1c1410" }, "shirt": "#d9772b", "background": "#f6e7d4", "glasses": false, "eyes": "#1c1410" }
        },
        {
            "id": "lite-professor", "name": "Professor", "tier": "lite",
            "description": "An illustrated professor with short grey hair, glasses and a purple cardigan, facing the camera",
            "look": { "skin": "#f1cfb4", "hair": { "style": "short", "color": "#b9b9bd" }, "shirt": "#5b4b8a", "background": "#e9e4f3", "glasses": true, "eyes": "#3b2f2a" }
        },
        {
            "id": "lite-mentor", "name": "Mentor", "tier": "lite",
            "description": "An illustrated mentor with long dark brown hair and a green shirt, facing the camera",
            "look": { "skin": "#c98e63", "hair": { "style": "long", "color": "#3a2418" }, "shirt": "#3f8f5b", "background": "#e1f1e6", "glasses": false, "eyes": "#2a1a12" }
        }
    ])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_presenter_has_what_the_editor_draws_from() {
        let all = list();
        let all = all.as_array().unwrap();
        assert_eq!(all.len(), 4);
        let mut ids: Vec<&str> = all.iter().map(|p| p["id"].as_str().unwrap()).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), 4, "the ids are different");
        for p in all {
            let id = p["id"].as_str().unwrap();
            assert!(id.starts_with("lite-") && id.len() <= 41 && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-'), "{id}");
            assert!(p["description"].as_str().unwrap().len() > 20, "{id} is described in words");
            let look = &p["look"];
            for colour in [&look["skin"], &look["shirt"], &look["background"], &look["eyes"], &look["hair"]["color"]] {
                let c = colour.as_str().unwrap();
                assert!(c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|d| d.is_ascii_hexdigit()), "{id}: {c}");
            }
            assert!(["short", "curly", "long"].contains(&look["hair"]["style"].as_str().unwrap()));
            assert!(look["glasses"].is_boolean());
        }
    }
}
