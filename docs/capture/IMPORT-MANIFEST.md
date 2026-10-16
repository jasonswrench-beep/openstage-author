# Capture import manifest

What was copied into this repository from the Capture repository, and from which commit.

| | |
|---|---|
| Source repository | `jasonswrench-beep/claude-test` |
| Source branch | `claude/screen-recording-software-brief-ivhxqp` |
| Source commit | `9c2c6fa303709f73650361e31e0a2cf12c5a5ce3` |
| Source commit date | 2026-10-15T18:34:06+00:00 |
| Files copied | 218 (214 identical to the source, 4 changed on import) |

## Where each part went

| In the source | In this repository |
|---|---|
| `capture/` (Rust workspace, scripts, rule checker) | `capture/` |
| `capture-edit/` (edit model, TypeScript) | `capture-edit/` |
| `capture-timeline/` (clip list, timeline and preview screens, TypeScript) | `capture-timeline/` |
| `docs/*.md` (eight documents) | `docs/capture/` |

## Not copied

- `LICENSE`: this repository has its own Apache License 2.0 file. The text is the same.
- `README.md`: it describes the Capture repository on its own. This repository keeps its own `README.md`; `docs/capture/HANDOVER.md` takes its place for Capture.

## Changed on import

Everything else is byte for byte what the source commit holds. These files differ, and nothing else does:

- `capture-edit/README.md`: One link to the edit format document now points into `docs/capture/`. No words changed.
- `capture/README.md`: Five links to the documents now point into `docs/capture/`. No words changed.
- `capture/tools/check_rules.py`: The one code change. The rule checker's list of documents folders: `REPO / "docs"` became `REPO / "docs" / "capture"`, because the Capture documents live in `docs/capture/` here and the other documents of this repository are not Capture's to check.
- `docs/capture/roadmap.md`: One line added after the Scope line, naming the source commit. The rest is word for word.

Comments inside the Rust and TypeScript code refer to the documents as `docs/prd.md`, `docs/capture-protocol-spec.md` and so on. Those comments were left as they are, so the code is unchanged. In this repository, read `docs/X.md` in those comments as `docs/capture/X.md`.

## Line endings

This repository's `.gitattributes` gives `.bat`, `.cmd` and `.ps1` files Windows line endings when they are checked out, and keeps Unix line endings inside git. Checked by making an archive of the staged files and comparing every file with the source commit: all 23 `.bat` files come out byte for byte as in the source. One file, `capture/tools/hands-free-helper.ps1` (plain ASCII), has Unix line endings in the source and comes out with Windows line endings here; PowerShell reads either, and its checksum below is for the Unix form. Every other file is identical after checkout, apart from the four listed above.

## Added by the import commit (not from the source)

- `docs/capture/IMPORT-MANIFEST.md` (this file)
- `docs/capture/HANDOVER.md`

The CI file `capture/ci/capture.yml` is copied but switched off: it sits in `capture/ci/`, not in `.github/workflows/`, so GitHub does not run it.

## Files

SHA-256 of each file as it is now in this repository.

| File | Bytes | SHA-256 | State |
|---|---|---|---|
| `capture-edit/.gitignore` | 14 | `4d56952b0fb13bf8f9b6c13a6d4c34a075bac3af447636a1df4335d7576e2f97` | identical |
| `capture-edit/README.md` | 2721 | `fb1cb232eec7c53ff258bea963a9064484dcc1e8bc4524ab33c0c753c291b17c` | changed on import |
| `capture-edit/fixtures/bad-color.json` | 3792 | `4e6539be2979a7bb7f34c580af5a8f267f1194967d7c9642dba3337ff3114042` | identical |
| `capture-edit/fixtures/bad-item-time.json` | 3794 | `713a40d0e90fc287efaf6b127dddedc688e5445dd0016860266db8915cc84f7f` | identical |
| `capture-edit/fixtures/bad-placement.json` | 4217 | `f3815530ed154c74f7b18d8507bf881a40b7fe816c193802918484f0e186430e` | identical |
| `capture-edit/fixtures/bad-rect.json` | 3793 | `3daab1313b1bf9cd1c1179244f9fd708f3490232a42d9e254a9fb45e9060124f` | identical |
| `capture-edit/fixtures/bad-style.json` | 3798 | `9a440bb26262f4c6dc0a46eb4d75421741552f1f79620ca7e1b37788d6888adc` | identical |
| `capture-edit/fixtures/bad-time.json` | 3377 | `5cf1e220137242fd8ca61494d7a2d6687fcadfd4c8fb14cf0b11ddd8a7e4817e` | identical |
| `capture-edit/fixtures/bad-track-kind.json` | 3378 | `efcdc130b3729d052cef1a020fe33d994961fdeadb09ab8cf475b3c37cda333f` | identical |
| `capture-edit/fixtures/beyond-source.json` | 3376 | `101b30f4b2ec0932a2db903d0820f18308637b952edbafed76154190d5b3a3a2` | identical |
| `capture-edit/fixtures/duplicate-id.json` | 3376 | `2ab34e232dee477e5c14f18566259d7aa8768b16131145e6aa4b63be33f5aa22` | identical |
| `capture-edit/fixtures/expected.json` | 4251 | `1929a439b1ab34992cd41e204dad44eed76d8efad3a479b27dc26834a0254350` | identical |
| `capture-edit/fixtures/fade-too-long.json` | 3384 | `34bda22173bbcb1ba85e5add487fd2c6dce7f402883c9fa376a9c8f01cdb9d51` | identical |
| `capture-edit/fixtures/future-version.json` | 3376 | `bf1bbda624e92ab10931c3d7a465c7aa4783fa3cf67426f7c5cace8b5b9251bb` | identical |
| `capture-edit/fixtures/imported-video-too-long.json` | 3757 | `ed09167c83e6334b4895a8c49f1bf40beaf0f551161c3002c1c9762b7d2e821b` | identical |
| `capture-edit/fixtures/item-too-short.json` | 3794 | `6e6e7d9b4a97f3462c17210deb72d2d8ce6a93010b24ad8ec8c63a976245fa28` | identical |
| `capture-edit/fixtures/item-wrong-track.json` | 4271 | `ab9a70377b120e954c417ea0d01641e9c344540c0984ab1b2e3eb023a099dd8c` | identical |
| `capture-edit/fixtures/needs-attention.json` | 2322 | `42071b12fb2b965b57da20d9884ec52934c612bb582ff1b76eb0ce1e28376c5e` | identical |
| `capture-edit/fixtures/needs-item-attention.json` | 3738 | `f833f1563590d87c044f3eb0fedbe82363cf66f80b9f067ca2d6be1b0e8e83be` | identical |
| `capture-edit/fixtures/not-an-edit.json` | 3368 | `7093a3380930a7757066c2938aea2e5a4254ff4315586fd41eb830f5edcb36ad` | identical |
| `capture-edit/fixtures/overlap.json` | 3376 | `be306f0aa4a2301366f9dbe15aaecfbb8cad8b0e1f01348899016860ba1f09f4` | identical |
| `capture-edit/fixtures/placement-on-sound.json` | 4348 | `649553166edae40625fe3df2a8ef08f23c7f79afb67a0bfd9543e130a96934ac` | identical |
| `capture-edit/fixtures/source-not-allowed.json` | 3373 | `11aef6c5caea13d3cbbc5e53361e7182894ce0d72ea84f252832b5a9bdc8fba9` | identical |
| `capture-edit/fixtures/text-empty.json` | 3778 | `2c4960b2cea39aee40528e347cd011fd1f50f837a0189244c7447c4d80a9c0fd` | identical |
| `capture-edit/fixtures/too-many-zooms.json` | 4883 | `b1c7127cb40f37856bc7b3a8662afeec1bb9c5512ad5719601ded69ecce01d39` | identical |
| `capture-edit/fixtures/too-short.json` | 3376 | `9abc668a617d493e705e9884b80eac3146fa50bfbb89c96fc31248ee98d6283b` | identical |
| `capture-edit/fixtures/transition-too-long.json` | 3797 | `97dd014fa93eeb1cb8933095318b9ef60c271096b69071922297447249cdf8c9` | identical |
| `capture-edit/fixtures/unknown-item-kind.json` | 3800 | `4256f29194bcd654c8ef5be547822d39b1d8f9f004466e56d116d512e9f0cafa` | identical |
| `capture-edit/fixtures/unknown-source.json` | 3376 | `ce5dcc1d0a09a734d5a5a75439ad3addb7464453c10527df2bd42243ba753131` | identical |
| `capture-edit/fixtures/unsorted-items.json` | 3796 | `8f85d3569413ce302d3d8228ab6f95e58fcea159895c25a6ed2160fea4dee307` | identical |
| `capture-edit/fixtures/unsorted.json` | 3376 | `5fb735950cea5f1e02539be65c70855739a3e10f3c1b19b3647b0f0a33ff6d8c` | identical |
| `capture-edit/fixtures/valid-basic.json` | 3376 | `1d66c4bc30337486fd6be12f177cc8dbbb5eec9d3fd8589b61f97ecdc82ff754` | identical |
| `capture-edit/fixtures/valid-placement.json` | 4216 | `e40cd13e0a249d5ad8aa780242c5e7123daf8eeed930fe580396e49d7f86b5d4` | identical |
| `capture-edit/fixtures/valid-with-imports.json` | 3758 | `c9e2b9b34d5800364bcfee445e605f7a942258c71a602286aa9badd02acfc109` | identical |
| `capture-edit/fixtures/valid-with-overlays.json` | 3796 | `bb7def8533d6779f34ebebb0cd31b1c0a86fcc8253523519dacd3397b23922cb` | identical |
| `capture-edit/fixtures/volume-range.json` | 3377 | `b8bb57212a0c3e112885fbb8eaf9453cb012da8a6fc8761b6ffdaf4b7b2ebe1a` | identical |
| `capture-edit/fixtures/warnings.json` | 4274 | `cd87634bc4ffe00ab80c40f1d69788dff18347f1ffd0cfbf6a1fdc83b61c854c` | identical |
| `capture-edit/fixtures/zoom-overlap.json` | 4163 | `cc41957e31398839ed2d7cd5836e92f3e0c6da16d95da86bcfcb545861ce3047` | identical |
| `capture-edit/package.json` | 519 | `64964ca0d8a0e373a20bdf5de725f2561f9279192af8af9d5e35494c4b308ba1` | identical |
| `capture-edit/src/contrast.ts` | 2632 | `3ca1f7f670638d05d5163150dd71bd9f96f12bcf98f89c5d58bccde07255daa5` | identical |
| `capture-edit/src/fromTakes.ts` | 5248 | `890a3e0c03fcc531c1109bda3010dcde40184bcd15ae983749e4907d54e35934` | identical |
| `capture-edit/src/history.ts` | 4620 | `7986e02ec3b73ac8418c48f99dce0de06c0f2a93af06d18d59e07431a7d4ec8c` | identical |
| `capture-edit/src/index.ts` | 424 | `021a9d68615d741bcef147261c05410e70091546c6c17e97fd61417f0ab021e8` | identical |
| `capture-edit/src/items.ts` | 19285 | `4dffccea78b1e982cba20cc8d14cd96ab0984914074339c4b555cd661b6bb9e8` | identical |
| `capture-edit/src/limits.ts` | 4455 | `9dd9870a0f53d2a96ba771b59d09f5519ce39e0ad9da6eaa7b442c1b06ac4c31` | identical |
| `capture-edit/src/model.ts` | 11667 | `006be051c538b80f0dcf1f694d21af2a4fecb1b0b846f35df8a764612b27af23` | identical |
| `capture-edit/src/ops.ts` | 33007 | `b98892fa29c0ed217973ff5570bf02cd2e09ca4542c8dd29fefb49add944e675` | identical |
| `capture-edit/src/playback.ts` | 5766 | `8e8028a62ba35211ead3374263c66311b818817497fbd9277feefeecb4f0a24b` | identical |
| `capture-edit/src/preview.ts` | 13096 | `8d79e9ba7d3a5609a0e5035e0fa76ca1df2bf56fa6fe346f0ca64e49299aa613` | identical |
| `capture-edit/src/regions.ts` | 3197 | `12a58a9782f605709ab6f14ad5d329ab36c8b5ca1113b4739c7db69b824bb073` | identical |
| `capture-edit/src/serialize.ts` | 12982 | `007537b7a523c618b7b1f1537fc84f1232a70f82b056f4833a59e3bae6940dbe` | identical |
| `capture-edit/src/time.ts` | 5946 | `0eecb386c81748ef66880831c70eea3084085cb4a977ad2e39ca8b940c2f402e` | identical |
| `capture-edit/src/validate.ts` | 15845 | `daa88cf7758e9b44245e93f577f49fd4be76d864fff706b65a724e2cba1f0ec0` | identical |
| `capture-edit/test/fixtures.test.ts` | 1324 | `f313e8318fd08872306e296bf1d718fd2cab87b6ab0a32827568b2f55c23b021` | identical |
| `capture-edit/test/fromTakes.test.ts` | 3938 | `973c33c56b43756c367196639ed23b123474a7d46c5f946f7ef177fe8bd3546d` | identical |
| `capture-edit/test/fuzz.test.ts` | 7595 | `6e6335cb10a82bca0057ff905e8a2fde66450cbdd65f732bfe740d6e2fdc96ab` | identical |
| `capture-edit/test/helpers.ts` | 3256 | `eeeada7b62918d0a7f9c47a8f34d349a166621939719de9540eef5d7d8ed7429` | identical |
| `capture-edit/test/history.test.ts` | 5274 | `a372f5bcce7a0df03bcce862ffda421e2e8caad69424abc5fcd73bb9a175eb48` | identical |
| `capture-edit/test/items.test.ts` | 21265 | `a7d644b70b9e9df20fdde0991f566bd582fa53b49c3b711e8c72c4108e9ab661` | identical |
| `capture-edit/test/limits.test.ts` | 8666 | `b1e48128d31de0779b9ec6f03ad352497a2aa706dad51f5eec503d8f2743a36b` | identical |
| `capture-edit/test/ops.test.ts` | 24742 | `4da665ee0e081a3c62e73aa4a6d51b115a5a8a1e15b7f1be807aa3f8fa15e2c1` | identical |
| `capture-edit/test/playback.test.ts` | 5814 | `febe05872ac4ed5e8cad3cc06c845254d860024db533a32cc058807e5f3a8ef2` | identical |
| `capture-edit/test/preview.test.ts` | 4238 | `10999490b106dff615cedf82e042a9f755f89dc99655fbf8d8e23906e508ff8c` | identical |
| `capture-edit/test/serialize.test.ts` | 4371 | `e4c3e095be9de7fe8f2d77cb5a6768cb286da46fe3971b9655fb2569fe243d79` | identical |
| `capture-edit/test/time.test.ts` | 3388 | `c1f9dabacf368eeed56a39c1ef1167917c225723581fab8c5e000e4b1087b21d` | identical |
| `capture-edit/test/tracks.test.ts` | 5722 | `04a8c9cf776ceedba03f26e203069120d5d5d0fb31941ddd4981bf772acb3e5b` | identical |
| `capture-edit/test/validate.test.ts` | 4158 | `d98a0ea4e07f89a79935622f09ef4c165cc94ed8ecc006399abe2a05857fdaed` | identical |
| `capture-edit/tsconfig.json` | 530 | `6290e2ac1ecfc7026e9c8d551fb5b81aca25c829a13ab2bc330ec2707d4cf88c` | identical |
| `capture-timeline/README.md` | 20325 | `8a2b2be53ee2d10f8e36b853a958c3cd5cda2010365d01e682b2e172a6753718` | identical |
| `capture-timeline/demo/demo.ts` | 7243 | `cac639dda4916923f694bd3e1ba967ab5014baaf81e599f72af9136814d04f7a` | identical |
| `capture-timeline/demo/files.ts` | 4899 | `3a124d6faea6e553cd282c1b25c8ce5129a439cd2eb77a152cd952db3e2bc791` | identical |
| `capture-timeline/demo/index.html` | 2703 | `e9122c3ad16d4988583eaa9532eea723a5aafbdd990663ffe80b000be306a4a0` | identical |
| `capture-timeline/demo/serve.mjs` | 6054 | `fee108fb1df1ed9c06e67c1d402761d1d501c8b39d827642df167d796836aadb` | identical |
| `capture-timeline/package.json` | 567 | `3c0f53855eb537c746ab95802c557bd569c904ea194aab4f458dda4d290d715f` | identical |
| `capture-timeline/src/announcer.ts` | 1628 | `cb7102e02318633470867dff7ed5b63f1cdde35e25a490a79768a2e6e4413e63` | identical |
| `capture-timeline/src/clip-list.css` | 6607 | `39793c33bc0eb30e3f108f134852eeefedd008d8d8b210b8672cbd5c044ecf81` | identical |
| `capture-timeline/src/commands.ts` | 4281 | `9b97533a1ff8b5d28d8ec35e518955b13242706e986a1dcf060e7a0dcd816038` | identical |
| `capture-timeline/src/dom.ts` | 819 | `2837178dd897e3ff6625969621df9f02a6ba3270e7d4e7428e46b171acd624f7` | identical |
| `capture-timeline/src/editor.ts` | 3244 | `f9ba24ac1ae5dd4048df029c68d255a2e1f9413aae3624b945bd2e9a7844911e` | identical |
| `capture-timeline/src/geometry.ts` | 4693 | `99a9a440d7de6d97c75d55fcbb4686a819b62b2220981ddae185fd85e7109dd2` | identical |
| `capture-timeline/src/index.ts` | 352 | `8e4c118a33f37b22cfb999895935a547f645f987bbdf4f532a981b956b51c5ab` | identical |
| `capture-timeline/src/panel.ts` | 26729 | `ae232876f7f39eed2323b929d14b0cd0f28d22247c9d263aa197389421da07c8` | identical |
| `capture-timeline/src/preview-panel.ts` | 18495 | `0d0a7eeedd236bb00c8cbda3c5aac684261303cd50c78982405592e8955c3862` | identical |
| `capture-timeline/src/preview.css` | 2244 | `8c4e5a38dd52c54cfed74d1a310defacf970d8acb84dcaea636bbd1409e898e1` | identical |
| `capture-timeline/src/project.ts` | 12760 | `b4bc4d1acb5acef42b68d82d532905d7e1d24c513c22a79c9833c88438a01d96` | identical |
| `capture-timeline/src/sample.ts` | 4675 | `31721d5749343406bb3518a578758f15408d21056636b4e1e875d175f705d632` | identical |
| `capture-timeline/src/session.ts` | 41774 | `96b7a94e1e1188c353d5cdef2baac889c9e09f9714729f977ca36f2c4d9e9984` | identical |
| `capture-timeline/src/timeline-panel.ts` | 33861 | `25d88b7b4b493ee12b52f5b6f8974727eb880038e457ca3c25b46889f10d6312` | identical |
| `capture-timeline/src/timeline.css` | 6448 | `7455b25f6a1a11e61436a76c12a8581c9e11c53f22af77f909e115fc8423766e` | identical |
| `capture-timeline/test/choice.test.ts` | 11892 | `9790b5d3dd4f7e04a9c5d925e1dbe494891191e5154c2976b0a8f5e9590d1f79` | identical |
| `capture-timeline/test/drag.test.ts` | 13180 | `2e3dd28037443ecbc1211350ba26ff3ad629e0f4a1523112bf7ecf1e8f697d44` | identical |
| `capture-timeline/test/geometry.test.ts` | 5533 | `dbb370b1f691e9bdaf56ba204fb54bbce038a6eedda892b18fac05d8cbc3a32d` | identical |
| `capture-timeline/test/helpers.ts` | 1553 | `80ac75b076531f749a20cd33e96039e3c977ac64270ca5bfdd0ea437d8cf5fbc` | identical |
| `capture-timeline/test/project.test.ts` | 9352 | `69838bf5778742852ad6b473a15fc7fe302b168a1de85c94d49e8dbc5acee75e` | identical |
| `capture-timeline/test/session.test.ts` | 24367 | `947e9812de5466404f3ca76cf86d259f0f8cf958e7710fdd7cc66a1aa343bd47` | identical |
| `capture-timeline/test/transport.test.ts` | 1736 | `63ffc2c1029657626d9ec3f2040af3492181795aec33f7d92d3f41ee256b049f` | identical |
| `capture-timeline/tools/browser-check.mjs` | 64660 | `43f58251da013ae564cb821d4e9b218d91783801e5322c421f6b830b464ed4a9` | identical |
| `capture-timeline/tools/make-fixture.mjs` | 2556 | `eb62a379bc9cc4a6085fb246324e73c7e789646252f54f6d21573e6c3602122a` | identical |
| `capture-timeline/tsconfig.json` | 569 | `a3e2d0bc65a9aff568978211c7e0e315ab5cf6c3fd88de87b2ff5708ae3daccf` | identical |
| `capture/.gitignore` | 803 | `f9afdd257bc869f5aa3c1d7d8022ddf998d109c56e9fb440f3d35af0bd715fb3` | identical |
| `capture/BUILD CAPTURE.bat` | 2878 | `4c71525b3fa7a8453bdfb1e503d4ecbd4e9023cc3bc7628a0c2911727b972cdf` | identical |
| `capture/CHECK MY COMPUTER.bat` | 2571 | `1d41c02685cfaa77c507b32dfefd149bc690bd1efedb1010a15ca94b69afaa49` | identical |
| `capture/CHOOSE REGION.bat` | 3859 | `587385c67252c74e4e12c295d99c00aa3f45ec4c57fa39b9e8a49b5f2ea3c0a7` | identical |
| `capture/Cargo.lock` | 14722 | `d88e49f813cc396d4f7b57d52d9a4958d367da671a052a82423171d3d6bd4c3a` | identical |
| `capture/Cargo.toml` | 748 | `6e34c9f71b0b7c958ffc3d26348b5a67494bbee3419d99d664258e9339334513` | identical |
| `capture/FIND SOUND OUTPUT.bat` | 3387 | `6297ba9b81081d63a7b71d0e08515f35adf3ae16c4e26b8e03b5466ab4af1e4e` | identical |
| `capture/OPEN TIMELINE DEMO.bat` | 1591 | `46ba702d4c0acb61ae319de085364c80d87a5695809e699125b8e0e2083786eb` | identical |
| `capture/README.md` | 24365 | `473e6686aacca25182e6b3b54de0a65e2f6afcf07a80409cb88ca296ceff6f9d` | changed on import |
| `capture/TEST AUDIO CAPTURE.bat` | 4772 | `5138adfbe4cef727a96c68db1e8d37eb45a8061d19c00736afac3d32cc0f8d19` | identical |
| `capture/TEST CAPTURE.bat` | 3690 | `9b085b59aa3d53a23280f97d94449ee3a0d2dc326b3ea2e5c9a2b0633061de46` | identical |
| `capture/TEST CUES.bat` | 3427 | `0011f4113ccd9f6375cf8c2cbc4051936ca254671c3f4eb8c3a45ccb52d101e6` | identical |
| `capture/TEST EXPORT.bat` | 6663 | `437de3ee2a2c179b80f41b4fa6a568cfe3bd74ea8d13f467bc5f4cfedb9e447e` | identical |
| `capture/TEST INTERACTIONS.bat` | 7260 | `45aca7cee17429c894980de2b2ef63578efc0755802022c091579664459683cc` | identical |
| `capture/TEST LONG RECORDING.bat` | 7026 | `4cd691baa46b8e9f6db32ec26577d672637dd859026147d48e0712738592f7ed` | identical |
| `capture/TEST OUTPUT SWITCH.bat` | 5317 | `25d89cf181c3db50071d24c48fd860c4868da4b0c930b74f9bec23f8e7b088b8` | identical |
| `capture/TEST RECORD SCREEN.bat` | 6211 | `913de1887830f6e16685cb98725ae7d2e61bbe1de1d89925d66d8257a9502b5d` | identical |
| `capture/TEST RECORDER CRASH.bat` | 4298 | `4ca4c5ab9158690c3f2d3be73ef0d24e990cac2722ecf12a83db35ed61dae96b` | identical |
| `capture/TEST REGION.bat` | 5284 | `371ade29153026ba3285628f97f310243f98a46f6679c192c1d7d63d005b2863` | identical |
| `capture/TEST SCREEN CAPTURE.bat` | 3859 | `fe579d0e617f0e1f5bb0864071f8ed2f4b0c59476b67bb490b9bf724ec0e97b8` | identical |
| `capture/TEST SYNC TIMING.bat` | 4078 | `8c8b71cefc0e3f985e61fc2d4a8e63f04f76be30aef4b104f29816762027dd6d` | identical |
| `capture/TEST VIDEO CAPTURE.bat` | 3804 | `db38a5e369ba0a2a836d33c0e3c3c1489c85aaa2383208454186f7d05a3238fe` | identical |
| `capture/TEST VIDEO CRASH.bat` | 3969 | `442caf6d75320e9e76b53c3686f05c8ef17576de6e4bb9561e5ba9ca0e619ab6` | identical |
| `capture/TEST WEBCAM.bat` | 5417 | `56640dacbd39adf7d8e910b574326651332becfaddc16fd59b5a3bce7eccd980` | identical |
| `capture/TEST WINDOW.bat` | 4787 | `6b9ba2fb2d1c187ed88c31f31cbc017896c867e1dbf2e651347e76e33f0dc6de` | identical |
| `capture/THIRD-PARTY.md` | 2887 | `b3c6dc40b1342d6a30cb8a41628c3e0c7221780cab34c8c3087ebd63c89941ef` | identical |
| `capture/cargo-run.bat` | 2057 | `d2da8b70b714ad1edde1b62b37014354ed07d8865a359113bf374f963e9b97f3` | identical |
| `capture/ci/capture.yml` | 2234 | `4bf2e0a527f86942bb18b227fe694f09b61a28af9502c964b3970a626a45759b` | identical |
| `capture/crates/openstage-capture-cli/Cargo.toml` | 694 | `a665b6c775080885bb6dbbdb580f7eef4a73c1d137c149e362c7ec5c56b0fae3` | identical |
| `capture/crates/openstage-capture-cli/src/checks.rs` | 11805 | `b46d677d72f917fc02dfafc4a895c615e8b029825b3ce490965879e8b92bbc08` | identical |
| `capture/crates/openstage-capture-cli/src/demo.rs` | 3260 | `9a7914b169213f0c8dcbac25188b7d5bc5316376bc6e10194d74dfa418ba37f6` | identical |
| `capture/crates/openstage-capture-cli/src/interactions_cmd.rs` | 11705 | `07ce6ee1ec6cdb4674051bd24e3f593c647223095f374dc4505ab7c33bcf3e8a` | identical |
| `capture/crates/openstage-capture-cli/src/main.rs` | 67014 | `de4d3f6db8f84d0ec5314c25942c59b1271c41c303582f108de1ed41c904eea9` | identical |
| `capture/crates/openstage-capture-cli/src/plain.rs` | 13811 | `74e3bdb350f992992241a15bdc09c1d2111e85480fe800755bb050684dcb59ed` | identical |
| `capture/crates/openstage-capture-cli/tests/cli.rs` | 33687 | `fac0f8f8a948d4d9c38e475d406c68f023222c0ee3f0d4cd4325d8b1190e29b0` | identical |
| `capture/crates/openstage-capture-project/Cargo.toml` | 468 | `f0cfe842b333ec07c45276c1506be4cbe83f000910bea917bb7b266d84ec9978` | identical |
| `capture/crates/openstage-capture-project/src/edit.rs` | 36593 | `2dd3270d6d2f50cc39fc5f2de27cedaf807c112a824f4c71c96839dd97dd7746` | identical |
| `capture/crates/openstage-capture-project/src/error.rs` | 699 | `9a197f06febfa89a80a2e187af0944fa5fa4aa5051b6430f5aca96547aadd40d` | identical |
| `capture/crates/openstage-capture-project/src/events_log.rs` | 19380 | `93609c11bb3e7823c9211ab11e98df1b00a8f851e1c5cce18aa14ddbc1ff4387` | identical |
| `capture/crates/openstage-capture-project/src/fmp4.rs` | 10402 | `e22029874251185c84e278c06a02005798adfbf04c11850de554e4b310c3ace6` | identical |
| `capture/crates/openstage-capture-project/src/fsutil.rs` | 2505 | `b7a8d22881e7b49f4a74066e1a6b82738740d8248b18032b6e280b1595a02ad5` | identical |
| `capture/crates/openstage-capture-project/src/interaction_review.rs` | 22282 | `33af4cec69276b8feddcc8dc9910a38c1ec1dbd6fdcb0cb1e871e8bb6c3d06bb` | identical |
| `capture/crates/openstage-capture-project/src/lib.rs` | 2807 | `aadb6b87d0ac5a2cd6a83db82308d4b6010a7e9f0368b87b4de099112d5f2096` | identical |
| `capture/crates/openstage-capture-project/src/manifest.rs` | 5494 | `44a048c17b82416fb00a01b2db91eeac9cd1a3380e4360dc0786c4acb431f355` | identical |
| `capture/crates/openstage-capture-project/src/recover.rs` | 19267 | `fe4620abd31935572ecddbef1dcc3690ca80ad795908105b71050c8cd38441ec` | identical |
| `capture/crates/openstage-capture-project/src/segment.rs` | 11132 | `3445adb0a99dc76d4d52735be073d1d495af459f7eea74a3e37d3ac08cba370f` | identical |
| `capture/crates/openstage-capture-project/src/take.rs` | 18721 | `f47adec061d836b74454b18b4a96dc5ce2610e3f029660102c9426dc4b9f80c8` | identical |
| `capture/crates/openstage-capture-project/src/wav.rs` | 29860 | `3ad056e13be038088e4cd504b3e538a94b73f0d6a0ca2cc84fed8698c1656d31` | identical |
| `capture/crates/openstage-capture-protocol/Cargo.toml` | 361 | `fa9d379e894bc36ff5a491e074936b91f0c036a5954d6d3ccdfecc37fa48f2c1` | identical |
| `capture/crates/openstage-capture-protocol/src/lib.rs` | 10922 | `5740dc56a223b38b6a649c1eff34ba7b94f3cde7f72e3c4448b95c999b5f2ff0` | identical |
| `capture/crates/openstage-capture-render/Cargo.toml` | 449 | `d24c9be9012e16882a73229ccae996e869c2bc07d201fb9d4ab5af62425d6bc8` | identical |
| `capture/crates/openstage-capture-render/src/audio.rs` | 8615 | `78e42a3e247afdfe30ffc59a4909543ed67a83cf1b7589ee788c46d1fb87121d` | identical |
| `capture/crates/openstage-capture-render/src/canvas.rs` | 34985 | `7a448911b6c880521ff66e5c8fc0b52c4747e3fede4a76cc9b0db0e45d3e9288` | identical |
| `capture/crates/openstage-capture-render/src/compose.rs` | 28457 | `bfff36ba0602a52b51e8b81eaa4fa50036b3bf6bf2942debaf1b57bc40b3e738` | identical |
| `capture/crates/openstage-capture-render/src/lib.rs` | 1145 | `eccd6f247e21685a0f0306d8bf6bc52e67503d13803fe05209bde1ffad0f5686` | identical |
| `capture/crates/openstage-capture-render/src/plan.rs` | 16313 | `1b969dc9a033cf40451d76c24bc42f2ddd777283735a37bf57f0e12c0a7f0e26` | identical |
| `capture/crates/openstage-capture-render/src/text.rs` | 10009 | `1c075fbc9e3ffe0ecb36ea9b16f1097e3146318ba12df6f52b4655bf19b437a8` | identical |
| `capture/crates/openstage-capture-render/src/zoom.rs` | 5753 | `02173ebd881e932a7ca9d66e77a9932f7963eef91a81b4f3fd4b9260e6e18331` | identical |
| `capture/crates/openstage-capture-windows/Cargo.toml` | 2010 | `4a5feae069c617c97ac1716de3472fd81008dab7486663daad7ca6184687a4ee` | identical |
| `capture/crates/openstage-capture-windows/src/audio.rs` | 69633 | `4825de0d53181008f740d0241bf66b32bf3e114b69923f053ef0f892f3e77b47` | identical |
| `capture/crates/openstage-capture-windows/src/balance.rs` | 18732 | `9d220c20b8cd01751a554a792ddabc0e1dab12425d1566dc7bbc02eb187bff0f` | identical |
| `capture/crates/openstage-capture-windows/src/bmp.rs` | 3694 | `8aeca7bc56c3baa077398389154dc868ba7083addcc33e8120776a82605fab59` | identical |
| `capture/crates/openstage-capture-windows/src/crash.rs` | 14565 | `97654e0c9c2ae7c0402809a02539fd8b58833fc638e9f1b5bb0e33eaee269d26` | identical |
| `capture/crates/openstage-capture-windows/src/crash_words.rs` | 3369 | `91eaa4e600f8b4b324d6a6d7ee6db039cd32102e05a09d97daf2cbe0b88b145a` | identical |
| `capture/crates/openstage-capture-windows/src/cue_player.rs` | 6671 | `6006f641c997c5803255464cdedfc634fa1d2a49bac38645d24788e94483208b` | identical |
| `capture/crates/openstage-capture-windows/src/echo.rs` | 16853 | `4623fd35f1cecb529783511e9fe9f26d490437628aad7efde26b6157b4f26587` | identical |
| `capture/crates/openstage-capture-windows/src/export.rs` | 36224 | `5c03d1fffafa1735082bbcab3a72c2a867f2f225eee53d52822148f102f1f3ab` | identical |
| `capture/crates/openstage-capture-windows/src/interactions.rs` | 58197 | `7fbf7bc6901ad8880f9e3e0cea806b4a4db8100f26511d77c68e2e7e0f775f93` | identical |
| `capture/crates/openstage-capture-windows/src/lib.rs` | 29118 | `c993f8324ceb38b7f9b4ecf37fa563e96be99d2a9674fe1d0935e6b8a3bbd9e8` | identical |
| `capture/crates/openstage-capture-windows/src/make_edit.rs` | 14741 | `27f27e386b1134f6aeca3b479d27a4019d98e303c327c0c7b50dce5b571f1f85` | identical |
| `capture/crates/openstage-capture-windows/src/pick.rs` | 9906 | `a0bd728bd610832077e170f2e5e7bdd8554c3b6c703c2ed97b133e5504a7fa7f` | identical |
| `capture/crates/openstage-capture-windows/src/queue.rs` | 9769 | `adae916b3400cbe81bb44250a7afba143272168bfe5d93e5b1cc989e401e0a06` | identical |
| `capture/crates/openstage-capture-windows/src/record.rs` | 123446 | `80b4e276aafe30da68dc7ff51a1849590fa909b7a6ee7a0dfc1c8d29160fd524` | identical |
| `capture/crates/openstage-capture-windows/src/region.rs` | 16611 | `9ffe0f00f68c5abf4ac86eee05a6ddc6a0e2f2c7fde2e1f239494fe0e550dc56` | identical |
| `capture/crates/openstage-capture-windows/src/region_editor.rs` | 23344 | `ed4dca4b284257b17abf9a64a605964a5b66d69b8a7c1d6bfb62c4572c5dc625` | identical |
| `capture/crates/openstage-capture-windows/src/region_paint.rs` | 12895 | `6db4f46871c61776fc5d8b897b07f872a04fc318751673d4c58cf0dfd6aa7f7b` | identical |
| `capture/crates/openstage-capture-windows/src/render_cmd.rs` | 18791 | `f1c9d52057634b3ea406dfa6b823adbf10e468c93c008dc1cbc88be6b155bfba` | identical |
| `capture/crates/openstage-capture-windows/src/report.rs` | 42539 | `7bfd499dd5677fc32c5fa3e9c5408a9744c1ddf86a20e9860c6799a6305fdae2` | identical |
| `capture/crates/openstage-capture-windows/src/setup.rs` | 24192 | `91b76c3d8e657997b5cef79178dd30ae6a448f53fc6b6385d94c5fd51f128129` | identical |
| `capture/crates/openstage-capture-windows/src/sound.rs` | 73434 | `3e7e12d6e44f138c9a2cb1c4125095f4fcafd1066602c0e1d64eab8e2822609e` | identical |
| `capture/crates/openstage-capture-windows/src/stats.rs` | 2919 | `19057d83d703d520763fe6d23515529379a293e72467b4c94ebdd9bbe057738c` | identical |
| `capture/crates/openstage-capture-windows/src/timing.rs` | 20751 | `69b9686d4d4a0ff0ae661026a8a7a5df2dc51ecb43482e2d88ead392211611c0` | identical |
| `capture/crates/openstage-capture-windows/src/video.rs` | 58265 | `b1c61b54e20e5b8170fc4c19b03d9298cf53a3d30adfdef7bd95c18b52759a9c` | identical |
| `capture/crates/openstage-capture-windows/src/webcam.rs` | 55811 | `8eefe1581bb0a5ae9f7d31577a359413acd48587c8a755ca191b0d3692b163ca` | identical |
| `capture/crates/openstage-capture-windows/src/win.rs` | 19705 | `83ff9482db6bfae6ed1d5e3ab8e841f025dc02e4360e0c0e5104990e1e7b68ee` | identical |
| `capture/crates/openstage-capture-windows/src/win_audio.rs` | 17041 | `f8c942c66917b87bfc87de9816d90f8d7f6ec2c76983d9c918d8ca19b75f7061` | identical |
| `capture/crates/openstage-capture-windows/src/win_camera.rs` | 20552 | `cc64c8e632b80a3a87f448d3bac6abc1c9381df043a5ad9b0a0ff13f04cf05af` | identical |
| `capture/crates/openstage-capture-windows/src/win_console.rs` | 3759 | `2ff3e295e2db9e2fcc22b9e3648e4b56e71bbca984c5b39dc055968ae1999c8c` | identical |
| `capture/crates/openstage-capture-windows/src/win_cues.rs` | 1798 | `f9e4ade4d04e9adda21f0a87eeb82db6c830931d1fb93aa32a65e768eabb7cda` | identical |
| `capture/crates/openstage-capture-windows/src/win_interactions.rs` | 16815 | `02d8191ef609ac76aee0785eb537ee3d8a599afb4bf17eabce0af0581c3ce91e` | identical |
| `capture/crates/openstage-capture-windows/src/win_layered.rs` | 6248 | `e16922cc0995ea58240aabc2e292864a0a2e21174e399b414ddbc802e5c88824` | identical |
| `capture/crates/openstage-capture-windows/src/win_outline.rs` | 5228 | `b0aa099825d53a61befe0b2fd2ceae8013d0341194c3cac259011155fcac2c3a` | identical |
| `capture/crates/openstage-capture-windows/src/win_pictures.rs` | 18174 | `88d359cb188f39b6f9cea0ea831dd476f16289efb98bc7434308bf65e9db8aed` | identical |
| `capture/crates/openstage-capture-windows/src/win_region.rs` | 20014 | `1063f806b7d934c118f08a4fd30f899ccf4b50cefa98278acc5b2b155c38dd53` | identical |
| `capture/crates/openstage-capture-windows/src/win_setup.rs` | 3782 | `64c392d82c6baed52a403e5b0d718a299c70fe030a3bf6702eed569cecf0773f` | identical |
| `capture/crates/openstage-capture-windows/src/win_text.rs` | 6830 | `9f90b3fc6fd3746ac3b55b3a57f7a0a8de44ff5a99c1e7a4282d4d1e7bca373c` | identical |
| `capture/crates/openstage-capture-windows/src/win_video.rs` | 24828 | `704f2eb48727aa9e60b6a0e0bb6e59601eca3b76b75cbff01cb08cec1d6e09a4` | identical |
| `capture/crates/openstage-capture-windows/src/win_windows.rs` | 5251 | `4674f00d5d8423856039f08a2bcd174890714b8a9422fffeefff4a06220df78c` | identical |
| `capture/crates/openstage-capture-windows/src/window.rs` | 15357 | `71512a409a7231b6799e845c5fe83e41a99e626eb981a1295bd631ad845d648a` | identical |
| `capture/crates/openstage-capture-windows/src/yuv.rs` | 12750 | `3a9e7fc8507875d6082e8d099a517737d99b77974bedc60bcf84999f07222562` | identical |
| `capture/crates/openstage-capture/Cargo.toml` | 519 | `afd4f9443c3c4c226b878d8194017552a6aab22f3ed4322b82d8486eaf19eeb5` | identical |
| `capture/crates/openstage-capture/src/clock.rs` | 1678 | `14006f45bf03da810f6ac2722b3ed91ebe77400837bc2314a8495c14042cfb74` | identical |
| `capture/crates/openstage-capture/src/cues.rs` | 15181 | `f908038f824903c8b5a189010b27242e63a79ba5a194084608eede92fb85c858` | identical |
| `capture/crates/openstage-capture/src/lib.rs` | 1089 | `a663103d49509d3acb6c1ce5164b7b374a4f9680002bf5faf21ebcec9f3843f1` | identical |
| `capture/crates/openstage-capture/src/media.rs` | 7650 | `aa70d4027a7f6e783a050c92f248f2db17fa3b685a828b1983437aed452f3702` | identical |
| `capture/crates/openstage-capture/src/session.rs` | 71375 | `97ca52e8a8b6646e8b18fe58d0ab294104edd3c726bcc10a8c58aa77cbb67f34` | identical |
| `capture/crates/openstage-capture/src/source.rs` | 5463 | `bd4d61c31724273d833eb579650def3dc6998ae6ac2b70758211f6d851b5e970` | identical |
| `capture/rust-setup.bat` | 2990 | `b5d6eb3158faa9613958e227e6b01596884ad4690d025fc036b529e4eff767cb` | identical |
| `capture/rustfmt.toml` | 45 | `93ed1668bb2ca659e88711456b72320bf2f53369ecf278c4a61af0cb63cc3a1e` | identical |
| `capture/tools/check_rules.py` | 13756 | `ee5308799a64bae0c86f3be62a513e3abe9cb449bb19f22d99c3330fd1d98763` | changed on import |
| `capture/tools/hands-free-helper.ps1` | 6179 | `7e64a9fff0f56f16c9d7c326e0917c8696cabd8ed126c03f095d1e2ccd5080af` | identical |
| `docs/capture/capture-edit-format.md` | 23407 | `550887c4188d19ee4b8e6fad16cbdb478c1d4b189be23d948721f30e4f55f957` | identical |
| `docs/capture/capture-project-format.md` | 23839 | `e87ef0361a66f7567eaa5161bdf9b65875e4c97ec06ac85aed09b5fcd16bf5cd` | identical |
| `docs/capture/capture-protocol-spec.md` | 54032 | `7055fb03dde993b150deef6b93ddfc9b9f752618fd318cc679874aeeb5ae2ae7` | identical |
| `docs/capture/openstage-requests.md` | 22290 | `68d8be48e44d4ac6e59fa1158e5e15fe2fec03d04796f7d8225384aa95b50538` | identical |
| `docs/capture/openstage-session-handoff.md` | 25693 | `31177399f7087d399a8a86bd650844c74155f45c2a1a7d944ed39889cc03e864` | identical |
| `docs/capture/prd.md` | 47509 | `7a00138a577412fd2e8736d94ee431c860eabe7ed417cb57503a0e689e8e4774` | identical |
| `docs/capture/product-brief.md` | 78150 | `62de2b8f7fe71d5937f13f36b42c943f18457e8b3db3ce1abcc61837976758af` | identical |
| `docs/capture/roadmap.md` | 103607 | `5a97f4f6c79f16ba5576acf8054bfcebc38549f8fb55e7b68fbc871045f62615` | changed on import |
