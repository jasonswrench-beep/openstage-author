# Expected validator output for broken.osproj

This fixture is deliberately invalid. Every rule in `docs/validator-spec.md` that can be
triggered in a single small project is triggered here. If the validator does not report
all of the following, the validator has a gap.

## Errors (these stop a publish)

| Object | Rule |
| --- | --- |
| obj-0001 | Referenced asset does not exist |
| obj-0003 (button) | Trigger target names a layer that does not exist |
| obj-0003 (button) | Condition references an undefined variable |
| obj-0003 (both) | Duplicate object id within one project |
| project.json | Scene lists slide-missing with no matching file |

## Accessibility warnings (these never stop a publish, and each names its WCAG 2.1 criterion)

Accessibility findings warn, in every project, unless the project's `accessibilityBlockers` names the rule (see
`docs/validator-spec.md`). This project names none.

| Object | Rule | WCAG |
| --- | --- | --- |
| obj-0001 | Non-decorative object with empty altText | 1.1.1 |
| obj-0002 | Decorative object carries altText | 1.1.1 |
| obj-0003 (button) | Interactive object has click trigger with no keyActivate equivalent | 2.1.1 |
| obj-0003 (button) | Text contrast below WCAG 2.2 AA (#f5f5f5 on #eeeeee) | 1.4.3 |
| obj-0003 (both) | Two objects share tabOrder 1 on one layer | 2.4.3 |
| obj-0003 (video) | Time-based media with no captions and no narration script | 1.2.1, 1.2.2 |
| layer-base | Tab order is not a contiguous run from 1 (values are 1, 0, 1, 7) | 2.4.3 |

To see the findings as the validator reported them before accessibility findings became warnings, with each rule that raised an error
keeping it, run `python tools/validate.py examples/broken.osproj --block errors`. The tests do this, so a rule that stops firing fails a test.

## How to use this

Run the validator against this project. Compare against the table. Each row should have a
test asserting the validator produces that specific finding, so a rule that silently
stops working fails a test rather than passing unnoticed.
