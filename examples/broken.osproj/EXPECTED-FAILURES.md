# Expected validator output for broken.osproj

This fixture is deliberately invalid. Every rule in `docs/validator-spec.md` that can be
triggered in a single small project is triggered here. If the validator does not report
all of the following, the validator has a gap.

## Errors

| Object | Rule |
| --- | --- |
| obj-0001 | Non-decorative object with empty altText |
| obj-0001 | Referenced asset does not exist |
| obj-0002 | Decorative object carries altText |
| obj-0003 (button) | Interactive object has click trigger with no keyActivate equivalent |
| obj-0003 (button) | Trigger target names a layer that does not exist |
| obj-0003 (button) | Condition references an undefined variable |
| obj-0003 (button) | Text contrast below WCAG 2.2 AA (#f5f5f5 on #eeeeee) |
| obj-0003 (both) | Duplicate object id within one project |
| obj-0003 (video) | Time-based media with no captions and no narration script |
| project.json | Scene lists slide-missing with no matching file |

## Warnings

| Object | Rule |
| --- | --- |
| layer-base | Tab order is not a contiguous run from 1 (values are 1, 0, 1, 7) |

Note that tabOrder 1 appears twice on the same layer, which is an error rather than a
warning under the uniqueness rule. The contiguity problem is separate.

## How to use this

Run the validator against this project. Compare against the table. Each row should have a
test asserting the validator produces that specific finding, so a rule that silently
stops working fails a test rather than passing unnoticed.
