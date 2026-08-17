<div align="center">

# 🚚 dsh-claude-move

**Claude Code, Codex, OpenCode और Hermes को DeepSeek Harness में माइग्रेट करें — सत्र, यादें, कौशल, निर्देश और स्लैश कमांड को फिर-से-शुरू होने योग्य DSH सत्रों के रूप में कॉपी करें, केवल-कॉपी और अनुमोदन-गेटेड।**

*स्थानांतरित होते समय अपना Claude Code इतिहास बनाए रखें: एक ही इंस्टॉल, फिर-से-शुरू सत्र, चालू Claude Code के साथ लाइव तालमेल, और एक चार-स्रोत माइग्रेशन विज़ार्ड।*

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![DSH plugin](https://img.shields.io/badge/dsh-plugin-✅-green)](https://github.com/topics/dsh-plugin)
[![Node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-brightgreen.svg)](#)
[![CI](https://img.shields.io/github/actions/workflow/status/PerryLink/dsh-claude-move/test.yml?branch=master&label=CI)](https://github.com/PerryLink/dsh-claude-move/actions)
[![Version](https://img.shields.io/github/v/tag/PerryLink/dsh-claude-move?label=version)](https://github.com/PerryLink/dsh-claude-move/releases)
[![npm version](https://img.shields.io/npm/v/dsh-claude-move)](https://www.npmjs.com/package/dsh-claude-move)
[![npm downloads](https://img.shields.io/npm/dm/dsh-claude-move)](https://www.npmjs.com/package/dsh-claude-move)

[English](README.md) · [简体中文](README.zh.md) · [Español](README.es.md) · [Português](README.pt.md) · [हिन्दी](README.hi.md)

</div>

---

## अनुकूलता

- `dsh 0.1.0-rc.6` (web profile) को लक्षित करता है; peer निर्भरताएँ `0.1.0-rc.6` पर पिन हैं। Node `^22.19 || >=24`।
- अंतिम बार एक ताज़ा tarball इंस्टॉल के विरुद्ध सत्यापित: वास्तविक स्कैन, वास्तविक बैच आयात (आइडेम्पोटेंट पुनः-आयात), workspace जुड़ाव और पर्सिस्टेंस आर्टिफैक्ट की पुष्टि; macOS/Linux CI मैट्रिक्स द्वारा कवर हैं।

### अनुकूलता मैट्रिक्स (केवल सार्वजनिक सीम)

| सतह | उपयोग | अनुपस्थित होने पर फ़ॉलबैक |
|---|---|---|
| Host सेवाएँ (`tools` / `sessionPersistence` / `workspaceRegistry` / `commands` / `systemPrompt` / `skills` / `webServer`) | जहाँ सूचीबद्ध वहाँ आवश्यक | वैकल्पिक सेवाएँ प्रतिक्रियात्मक रूप से पंजीकृत होती हैं; `fs` अनुपस्थित होने पर ज़ोर से विफल |
| `sessionPersistence.listSnapshots` / `readFrom` / `streamText`-सक्षम `fs` / `ctx.jobs` / `ctx.agents.resume` | फ़ीचर-डिटेक्टेड | `list()` / पूरी फ़ाइल पढ़ना और ज़ोर से अस्वीकार / स्वयं का job map / हैंडऑफ़ इंजेक्ट |
| Client shell सेवाएँ (`sessions.refresh/open`, `workspaces.refresh`) | पैनल apply पर फ़ीचर-डिटेक्टेड | पूर्ण-पृष्ठ रीलोड |
| नई प्लेटफ़ॉर्म क्षमताएँ कभी कठोर आवश्यकताएँ नहीं होतीं — प्लगइन rc.6 पर बूट होने योग्य रहता है। | | |

## आपको क्या मिलता है

1. **स्वतः-खोज** — `claude_scan` Claude डेटा रूट (`$CLAUDE_CONFIG_DIR`, फ़ॉलबैक `~/.claude`) खोजता है और हर प्रोजेक्ट/सत्र, याद, कौशल, वैश्विक `CLAUDE.md` और `settings.json` को इंडेक्स करता है, वृद्धिशील कैश और समानांतर स्कैनिंग (`scanConcurrency`) के साथ।
2. **पूर्ण-निष्ठा आयात** — `import_claude` ट्रांसक्रिप्ट को संतुलित, फिर-से-शुरू होने योग्य DSH सत्रों में बदलता है (`turn/start → step/start → user/message → assistant/message → tool/call → tool/result → step/end → turn/end`), बाधित टूल कॉल की मरम्मत करता है, और `maxTranscriptBytes` से बड़ी ट्रांसक्रिप्ट को खंडों में स्ट्रीम-आयात करता है।
3. **एक `claudecode` workspace** — हर आयातित सत्र एक समर्पित workspace में जाता है (डिफ़ॉल्ट `$DSH_HOME/claudecode`); `workspaceMode: 'per-project'` प्रति-प्रोजेक्ट एक-workspace समूहन बहाल करता है।
4. **केवल-कॉपी और वृद्धिशील** — किसी भी तरफ कुछ भी स्थानांतरित, दोबारा लिखा या हटाया नहीं जाता; फिर चलाने पर केवल नए टर्न जोड़े जाते हैं (`force: true` एक नए id के तहत अतिरिक्त पूरी कॉपी सहेजता है)।
5. **व्यक्तिगत संदर्भ, हमेशा ताज़ा** — यादें लाइव प्रॉम्प्ट अनुभाग के रूप में इंजेक्ट होती हैं, Claude कौशल वास्तविक DSH कौशल के रूप में पंजीकृत होते हैं (वैश्विक + प्रोजेक्ट-स्तर), वैश्विक + प्रोजेक्ट `CLAUDE.md` जल्दी इंजेक्ट होता है।
6. **चार-स्रोत माइग्रेशन विज़ार्ड** — `/move` और `move_detect` / `move_preview` / `move_run` Claude Code, Codex, OpenCode और Hermes को माइग्रेट करते हैं, अनुमोदन-गेटेड और आइडेम्पोटेंट (`move.json`)।
7. **वेब पैनल और कमांड** — `/claude-import-all`, `/resume-claude`, `/claude-move-reset`, और एक फ़्लोटिंग माइग्रेशन पैनल।

## चार-स्रोत माइग्रेशन विज़ार्ड

```text
/move              # एक-चरण विज़ार्ड: पता लगाएँ → पूर्वावलोकन → निष्पादन → रिपोर्ट (चारों स्रोत)
move_detect        # Claude Code / Codex / OpenCode / Hermes को स्कैन करें
move_preview       # प्रति-आइटम योजना: new | unchanged | changed | conflict (diff सहित) | unsupported
move_run           # अनुमोदन गेट के पीछे निष्पादित करें; विरोध समाधान:
                   #   skip | overwrite | rename | merge  (डिफ़ॉल्ट skip — कभी अनुमान नहीं लगाता)
```

- **स्रोत** — Claude Code (`~/.claude`), Codex (`~/.codex`), OpenCode (डेटा + config रूट), Hermes (कौशल/याद रूट); हर स्रोत का अपना parser + mapper है।
- **मैपिंग** — यादें/निर्देश → DSH वैश्विक `AGENTS.md` में केवल-जोड़ने योग्य प्रबंधित अनुभाग (प्रति आइटम एक चिह्नित अनुभाग); कौशल → वास्तविक DSH कौशल (`SKILL.md` बंडल ज्यों-का-त्यों कॉपी, अन्य प्रारूप परिवर्तित); स्लैश कमांड → पंजीकृत DSH कमांड (पुनः प्रारंभ के बाद `move.json` से पुनर्निर्मित); सत्र → फिर-से-शुरू DSH सत्र (चरण 1 के समान आयातक)।
- **आइडेम्पोटेंट** — हर लागू योजना `$DSH_HOME/claude-move/move.json` में दर्ज होती है (`digest` / `targetDigest` / `appliedAt`); पुनः चलाने पर अपरिवर्तित आइटम छोड़ दिए जाते हैं और `force` उन्हें फिर से लागू करता है।
- **अनुमोदन-गेटेड** — कोई भी रन जो कुछ लिखेगा पहले `ctx.approval` से पूछता है; `allowed-once` के अलावा कुछ भी होने पर शून्य लेखन।

## त्वरित शुरुआत

```sh
# 1. अपने प्रोफ़ाइल में बंडल इंस्टॉल करें
dsh plugin --profile web add "github:PerryLink/dsh-claude-move#master"

# या npm से (प्रकाशित रिलीज़)
dsh plugin --profile web add dsh-claude-move

# 2. पुनः प्रारंभ करें और पंक्ति सत्यापित करें
dsh --profile web --dump-config | grep -A4 'id: claude-move'
```

फिर, किसी भी DSH सत्र में एक कमांड चलाएँ:

```sh
/claude-import-all      # स्कैन → हर Claude सत्र कॉपी करें → रिपोर्ट
```

आयात के बाद DSH को पुनः प्रारंभ करने की आवश्यकता नहीं है — खुले वेब पेज को एक बार रीफ़्रेश करें और जारी रखने के लिए किसी भी आयातित सत्र पर क्लिक करें।

## इंस्टॉल और अनइंस्टॉल

- **git चैनल** (नवीनतम `master`): `dsh plugin --profile web add "github:PerryLink/dsh-claude-move#master"` — शुद्ध ESM, कोई `prepare` या `allowBuilds` चरण नहीं।
- **npm चैनल** (प्रकाशित रिलीज़): `dsh plugin --profile web add dsh-claude-move`।
- **tarball चैनल**: इस रेपो में `npm pack`, फिर `dsh plugin --profile web add ./dsh-claude-move-<version>.tgz`।
- **अनइंस्टॉल**: प्रोफ़ाइल के bundles से `claude-move` पंक्ति हटाएँ और `dsh` पुनः प्रारंभ करें। आयातित सत्र DSH की डेटा निर्देशिका में बने रहते हैं; प्लगइन केवल अपना कैश (`$DSH_HOME/claude-move/`) और `claudecode` workspace फ़ोल्डर लिखता है, और Claude स्रोत डेटा को कभी नहीं छूता।

## क्या माइग्रेट होता है

```
~/.claude (केवल-पढ़ने)
 ├─ projects/*/*.jsonl  ──→  फिर-से-शुरू DSH सत्र, एक "claudecode" workspace में समूहित (डिफ़ॉल्ट)
 ├─ projects/*/memory/  ──→  लाइव system-prompt याद अनुभाग (प्रति अनुरोध फिर पढ़ा जाता है)
 ├─ skills/**           ──→  वास्तविक DSH कौशल
 └─ CLAUDE.md + settings ──→  आरंभिक प्रॉम्प्ट अनुभाग + config सुझाव (कभी स्वतः लागू नहीं)
```

| Claude Code में | DSH में इस रूप में पहुँचता है |
|---|---|
| सत्र ट्रांसक्रिप्ट (`projects/*/*.jsonl`) | संतुलित, फिर-से-शुरू DSH सत्र — `user`/`assistant`/`tool`/`thinking` की पूर्ण-निष्ठा मैपिंग और बाधित-टूल-कॉल मरम्मत के साथ — एक **`claudecode`** workspace में या प्रति प्रोजेक्ट एक में समूहित |
| याद फ़ाइलें (`projects/*/memory/*.md`) | एक लाइव system-prompt संदर्भ अनुभाग, हर अनुरोध पर फिर पढ़ा जाता है (`feedback > project > reference > user`) |
| कौशल (`~/.claude/skills/**`) | वास्तविक DSH कौशल (kebab-case नाम, टकराव प्रत्यय, डिफ़ॉल्ट रूप से अधिकतम 30; `README.md`/`MEMORY.md` और बिना विवरण वाली फ़ाइलें छोड़ दी जाती हैं) |
| `CLAUDE.md` (वैश्विक + प्रति-प्रोजेक्ट) | एक आरंभिक प्रॉम्प्ट अनुभाग; प्रोजेक्ट फ़ाइल प्राथमिकता पाती है |
| `settings.json` | स्पष्ट अनमैपेबल-कुंजी सूची के साथ DSH config सुझाव |
| प्रोजेक्ट स्थिति (निर्देशिका, git branch और गंदगी गिनती) | स्कैन इंडेक्स, वेब पैनल बैज और `/resume-claude` हैंडऑफ़ में दिखती है |

## उपयोग

प्लगइन माउंट होने पर किसी भी सत्र में टूल कॉल करें:

```
claude_scan                          # पूर्ण स्कैन (वृद्धिशील कैश)
claude_scan { path: "~/.claude/projects/<slug>" }   # आंशिक स्कैन
claude_scan { refresh: true }        # कैश छोड़ें, सब कुछ फिर स्कैन करें
claude_scan { projectsLimit: 10, sessionsLimit: 5, fields: "brief" }  # आउटपुट छाँटें

import_claude { path: "~/.claude/projects/<slug>/<sessionId>.jsonl" }  # एक सत्र
import_claude { path: "~/.claude/projects" }        # निर्देशिका (पुनरावर्ती)
import_claude { path: "all" }                       # सब कुछ
# कभी भी फिर चलाएँ: अपरिवर्तित फ़ाइलें छोड़ दी जाती हैं, बढ़ी ट्रांसक्रिप्ट केवल नए टर्न जोड़ती हैं।
# maxTranscriptBytes से बड़ी फ़ाइलें खंडों में स्ट्रीम-आयात होती हैं (कोई मेमोरी सीमा नहीं)।
import_claude { path: "...", force: true }          # ताज़ा पूरी कॉपी (पिछली कॉपी रखी जाती है)
```

कमांड (उपयोगकर्ता-ट्रिगर, कोई मॉडल टर्न नहीं):

```
/claude-import-all                # एक-चरण: स्कैन → सब आयात → रिपोर्ट → वर्तमान सत्र में इंजेक्ट
/resume-claude latest             # सबसे हालिया Claude सत्र जारी करें
/resume-claude <sessionId>        # स्रोत सत्र id या import-<src> id से
/resume-claude <keyword>          # शीर्षक मिलाएँ; कई मिलान सूचीबद्ध होते हैं, कभी अनुमान नहीं
/claude-move-reset                # प्लगइन कैश रीसेट करें (बुकमार्क + आयात मैप); आयातित सत्र बने रहते हैं
```

वेब पैनल: प्रोजेक्ट/सत्र ट्री, स्थिति बैज (आयातित नहीं / आयातित / नए-टर्न-सहित-आयातित / स्रोत अनुपस्थित / निर्देशिका अनुपस्थित / git गंदा), कीवर्ड फ़िल्टर, पृष्ठांकित रेंडरिंग, प्रति-सत्र "आयात करें और जारी रखें" + "सत्र खोलें" + "सत्र सूची रीफ़्रेश करें", लाइव प्रगति पट्टी और रद्द के साथ बैच आयात, और एक कैश-रीसेट बटन वाला फ़्लोटिंग माइग्रेशन पैनल। पाठ ब्राउज़र भाषा (zh/en) का अनुसरण करते हैं। सार्वजनिक `ctx.webServer` सीम पर प्लगइन के अपने `/api/claude-move/*` JSON मार्गों से परोसा जाता है।

## आयात के बाद

**आपको DSH को पुनः प्रारंभ करने की आवश्यकता नहीं है।** आयात पूर्ण होते ही सार्वजनिक `sessionPersistence` सेवा के माध्यम से टिकाऊ रूप से पहुँचते हैं:

- सर्वर-साइड सूचियाँ (`session.list` / `workspace.list` RPC, CLI, कोई भी नया पृष्ठ लोड) आयातित सत्रों को **`claudecode` workspace** के अंतर्गत तुरंत दिखाती हैं।
- पैनल पहले से खुले पृष्ठ की सत्र सूची स्वयं रीफ़्रेश करता है और हर आयातित सत्र के लिए **सत्र खोलें** बटन देता है।
- आयातित सत्र तुरंत खोले, पढ़े और फिर से शुरू किए जा सकते हैं — `/resume-claude`, या सूची में सत्र पर क्लिक करें। कभी भी आयात फिर चलाने पर उन्हीं सत्रों में केवल नए टर्न समन्वयित होते हैं।

## कॉन्फ़िगरेशन

सब वैकल्पिक, cordis.yml में ओवरराइड योग्य।

| कुंजी | डिफ़ॉल्ट | अर्थ |
|---|---|---|
| `claudeHome` | `$CLAUDE_CONFIG_DIR` या `~/.claude` | Claude डेटा रूट |
| `workspaceMode` | `claudecode` | `claudecode` (एक समर्पित workspace) · `per-project` (प्रति स्रोत cwd एक workspace) |
| `claudecodeDir` | `$DSH_HOME/claudecode` | `claudecode` workspace फ़ोल्डर (प्लगइन द्वारा बनाया जाने वाला एकमात्र फ़ोल्डर) |
| `scanGit` | `true` | git जाँच स्तर: `true` (पूर्ण) · `'branch'` (शून्य git कॉल) · `false` |
| `gitTimeoutMs` | `5000` | git उप-प्रक्रिया टाइमआउट |
| `scanConcurrency` | `8` | समानांतर प्रोजेक्ट स्कैन सीमा |
| `maxTranscriptBytes` | `67108864` | स्ट्रीम-आयात सीमा (ऊपर खंडों में) |
| `excludeProjects` | `[]` | छोड़ने के लिए slug उप-स्ट्रिंग |
| `enableMemory` | `true` | यादें लाइव प्रॉम्प्ट अनुभाग के रूप में इंजेक्ट करें |
| `memoryMaxBytes` | `8192` | याद अनुभाग सीमा |
| `memoryScope` | `current-project` | `current-project` · `all` (वर्तमान प्रोजेक्ट पहले) |
| `enableSkills` | `true` | Claude कौशल को DSH कौशल के रूप में पंजीकृत करें |
| `maxSkills` | `30` | कौशल संख्या सीमा |
| `extraSkillDirs` | `[]` | अतिरिक्त कौशल निर्देशिकाएँ |
| `enableInstructions` | `true` | वैश्विक + प्रोजेक्ट `CLAUDE.md` इंजेक्ट करें |
| `resumeMaxChars` | `2048` | हैंडऑफ़ सारांश वर्ण सीमा |
| `resumeMode` | `inject` | `inject` (हैंडऑफ़ सारांश) · `agents` (ctx.agents.resume) |
| `enableWebPanel` | `true` | `/api/claude-move/*` पैनल मार्ग पंजीकृत करें |
| `importConcurrency` | `4` | प्रति बैच समानांतर पढ़ना + रूपांतरण |
| `requireApproval` | `true` | विज़ार्ड लेखन `ctx.approval` माँगते हैं (केवल allowed-once) |
| `codexHome` | `$CODEX_HOME` या `~/.codex` | Codex डेटा रूट |
| `opencodeDataHome` | प्लेटफ़ॉर्म XDG डेटा dir/opencode | OpenCode डेटा रूट |
| `opencodeConfigHome` | प्लेटफ़ॉर्म XDG config dir/opencode | OpenCode config रूट |
| `hermesHome` | `$HERMES_HOME` या `~/.hermes` | Hermes डेटा रूट |
| `skillsDir` | `$DSH_HOME/skills` | विज़ार्ड कौशल लक्ष्य |
| `agentsMdPath` | `$DSH_HOME/AGENTS.md` | विज़ार्ड याद/निर्देश लक्ष्य |
| `moveWorkspaceMode` | `per-source` | विज़ार्ड आयात के लिए workspace समूहन: `per-source` · `single` |

## उपकरण और सतहें

| सतह | प्रकार | नोट्स |
|---|---|---|
| `claude_scan` | टूल | प्रोजेक्ट/सत्र/याद/कौशल/सेटिंग का संरचित इंडेक्स |
| `import_claude` | टूल | एक सत्र, निर्देशिका या `all` आयात करें (वृद्धिशील; `force` से नई कॉपी) |
| `move_detect` / `move_preview` / `move_run` | टूल | चार-स्रोत विज़ार्ड: स्कैन, diff सहित प्रति-आइटम योजना, अनुमोदन के बाद निष्पादन |
| `/claude-import-all` | कमांड | स्कैन → सब आयात → रिपोर्ट |
| `/resume-claude` | कमांड | Claude सत्र जारी करें (latest, id या कीवर्ड) |
| `/claude-move-reset` | कमांड | प्लगइन कैश रीसेट करें (आयातित सत्र बने रहते हैं) |
| `/move` | कमांड | एक-चरण चार-स्रोत विज़ार्ड |
| वेब माइग्रेशन पैनल | क्लाइंट | प्रगति, रद्द, पेजिंग, सत्र खोलें वाला फ़्लोटिंग पैनल |

## अनुमतियाँ और डेटा

- **अनुमतियाँ**: workshop मेनिफ़ेस्ट `filesystem:read` और `filesystem:write` घोषित करता है।
- **पढ़ता है** `~/.claude` (ट्रांसक्रिप्ट, यादें, कौशल, `CLAUDE.md`, `settings.json`) — सख्ती से केवल-पढ़ने — और जिन प्रोजेक्ट निर्देशिकाओं में आयात करता है।
- **लिखता है** सार्वजनिक `sessionPersistence` सेवा के माध्यम से DSH सत्र लॉग (केवल create + append, कभी हटाए/दोबारा लिखे/संग्रहीत नहीं), workspace-registry रिकॉर्ड, `$DSH_HOME/claude-move/` के अंतर्गत अपना कैश, और `claudecode` workspace फ़ोल्डर।
- **कभी नहीं** Claude स्रोत फ़ाइलों को बदलता, अन्य ऐप्स के डेटा को छूता, या नेटवर्क का उपयोग करता। **कोई** क्रेडेंशियल नहीं पढ़ा या भेजा जाता।

## सुरक्षा सीमाएँ

- **स्रोत फ़ाइलें केवल-पढ़ने; DSH लॉग केवल-append** (केवल `create` + `append`)।
- **बाहरी ट्रांसक्रिप्ट अविश्वसनीय इनपुट हैं** — उनमें कुछ भी निष्पादित नहीं होता; system/developer/thinking सामग्री कभी रिज़्यूम हैंडऑफ़ में नहीं जाती।
- **केवल सार्वजनिक सेवाएँ** — `sessionPersistence` / `workspaceRegistry` / `tools` / `commands` / `systemPrompt` / `skills` / `webServer`; इंजन या UI में कोई बदलाव नहीं।
- **गोपनीय जानकारी केवल स्थान से सूचित** होती है (file:line:kind); `permission`/`permission-mode`/`queue-operation` रिकॉर्ड गिने जाते हैं, आयात नहीं किए जाते।
- **विज़ार्ड लेखन अनुमोदन-गेटेड** — `allowed-once` के अलावा कुछ भी होने पर शून्य लेखन।

## ज्ञात सीमाएँ

- शीर्षक `custom-title`/`ai-title`/पहले प्रॉम्प्ट से आते हैं; Claude `summary` रिकॉर्ड सूचित होते हैं पर DSH compaction नोड में मैप नहीं होते (एक वैध compaction लेनदेन संश्लेषित करने पर उसकी seq रेंज और checkpoint संदेश गढ़ना पड़ेगा)।
- `thinking` ब्लॉक `reasoning` सामग्री के रूप में रखे जाते हैं, पर कभी रिज़्यूम हैंडऑफ़ में नहीं जाते।
- बाधित टूल कॉल सिंथेटिक त्रुटि परिणाम से मरम्मत होते हैं (कभी छोड़े नहीं जाते), `repaired.synthesized` के रूप में सूचित।
- अनुमति-वर्ग रिकॉर्ड गिने जाते हैं, आयात नहीं किए जाते; DSH अनुमति-प्रीसेट सुझाव रिपोर्ट में उत्पन्न होते हैं।
- स्ट्रीमिंग `fs.streamText` सतह के बिना होस्ट पर, `maxTranscriptBytes` से बड़ी ट्रांसक्रिप्ट आंशिक आयात के बजाय ज़ोर से विफल होती हैं।
- `workspaceMode: 'per-project'` में, जिन सत्रों की स्रोत निर्देशिका हटा दी गई थी वे फिर भी आयात होते हैं पर workspace जुड़ाव विफल रहता है (बिना समूह के छूट जाते हैं; `workspace.attached: false` और एक `reason`)। डिफ़ॉल्ट `claudecode` workspace स्रोत निर्देशिका पर निर्भर नहीं करता।
- यदि कोई ट्रांसक्रिप्ट स्थान पर ही काट दी गई या रीसेट कर दी गई (दर्ज आयात से कम टर्न), तो पुनः-आयात उसे छोड़ देता है और `sourceShrunk` सूचित करता है; ताज़ा पूरी कॉपी के लिए `force: true` का उपयोग करें।
- वेब पैनल प्लगइन के अपने JSON मार्गों से चलने वाला शून्य-बिल्ड फ़्लोटिंग पैनल है; यह shell की आंतरिक UI स्लॉट प्रणाली का उपयोग नहीं करता।

## मॉडल अनुभव

- मॉडल के सामने की सतह दो टूल के विवरण/schema और उनके आउटपुट हैं: `claude_scan` संरचित इंडेक्स लौटाता है, `import_claude` चेतावनियों की स्थिति के साथ प्रति-फ़ाइल सारांश लौटाता है। टूल परिणाम स्वयं `tool/result` घटनाओं के रूप में लॉग होते हैं, इसलिए सब कुछ पुनर्निर्माण योग्य है।
- कोई छिपा मॉडल-सामने पाठ नहीं; याद/`CLAUDE.md` अनुभाग `ctx.systemPrompt` पर पंजीकृत होते हैं (प्रॉम्प्ट असेंबली, सत्र लॉग से पुनर्निर्माण योग्य)।

## समस्या निवारण

- पंक्ति प्रभावी नहीं: `dsh --profile <p> --dump-config` को `# == dsh-claude-move` छापना चाहिए; `dsh plugin --profile <p> add ...` फिर चलाएँ।
- वेब बूट होता है पर चुपचाप अटक जाता है: `dsh plugin add` द्वारा आरंभ किए गए नए प्रोफ़ाइल में केवल `dsh-base` होता है — `dsh.profile.bundles` में `@deepseek-ai/dsh-web-app` जोड़ें। मौजूदा `web` प्रोफ़ाइल में इंस्टॉल करने पर कुछ भी नहीं चाहिए।
- पैनल मार्ग 404: वे केवल तभी परोसे जाते हैं जब `enableWebPanel: true` और एक वेब सर्वर संयोजित हो; बूट लॉग में FAILED fibers देखें।
- आयात "transcript 过大" के साथ विफल होता है: `maxTranscriptBytes` बढ़ाएँ या उस फ़ाइल को अलग से आयात करें।
- आयात सफल हुआ पर साइडबार कोई नया सत्र नहीं दिखाता: पृष्ठ पहले से खुला था — पैनल का रीफ़्रेश बटन एक बार क्लिक करें (या पृष्ठ फिर लोड करें)। DSH को पुनः प्रारंभ करने की कभी आवश्यकता नहीं होती।
- लॉग: बूट विफलताएँ `dsh` कंसोल में छपती हैं; प्लगइन workspace/आयात-मैप समस्याओं के लिए `[claude-move]`-उपसर्ग वाली त्रुटियाँ लॉग करता है।

## श्रेय (ओपन-सोर्स घटक)

यह प्रोजेक्ट Apache License 2.0 के अंतर्गत लाइसेंस प्राप्त है; निम्न MIT-लाइसेंस प्राप्त घटक अपने स्वयं के लाइसेंस बनाए रखते हैं (पूरा पाठ [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) में):

- रूपांतरण कोर [Nwflower/dsh-chat-import](https://github.com/Nwflower/dsh-chat-import) से vendored (MIT)।
- खोज परंपराएँ और सुरक्षा मॉडल [Demogorgon314/dsh-resume-plugin](https://github.com/Demogorgon314/dsh-resume-plugin) से (MIT)।
- याद/कौशल इंजेक्शन और frontmatter पार्सिंग पैटर्न [YYTbit/dsh-plugin-claude-bridge](https://github.com/YYTbit/dsh-plugin-claude-bridge) से (MIT)।

## विकास

```sh
npm install   # peer deps: @deepseek-ai/dsh-tools@0.1.0-rc.6, @deepseek-ai/cordis, schemastery
npm test      # node --test test/*.test.mjs
```

CI GitHub Actions ([test.yml](.github/workflows/test.yml)) के माध्यम से Linux/macOS/Windows पर Node 22 में पूरी सुइट चलाता है।

## विषय

`deepseek-harness`, `dsh-plugin`, `claude-code`, `migration`, `session-import`, `resume`

## योगदानकर्ता

- [@PerryLink](https://github.com/PerryLink) — निर्माता और अनुरक्षक: आयात पाइपलाइन, चार-स्रोत माइग्रेशन विज़ार्ड, वेब पैनल, दस्तावेज़, CI/CD और रिलीज़।
- [@OLDnana1](https://github.com/OLDnana1) — बाधित टूल-कॉल भ्रष्टाचार का मूल-कारण विश्लेषण, जिसके कारण आयातित सत्र रिज़्यूम पर स्थायी रूप से HTTP 400 लौटाते थे।
- [@GooodWei](https://github.com/GooodWei) — पहचाना कि `README.md` (और कोई भी विवरण-रहित `.md`) गलती से कौशल के रूप में पंजीकृत हो जाता था, जिससे DSH का कौशल लोड टूट जाता था।

## PerryLink DSH प्लगइन परिवार

यह प्रोजेक्ट [PerryLink](https://github.com/PerryLink) द्वारा अनुरक्षित DeepSeek Harness प्लगइन में से एक है। यदि यह आपकी मदद करता है, तो बाकी भी संभवतः करेंगे:

| प्लगइन | एक पंक्ति |
|---|---|
| [dsh-mcp-panel](https://github.com/PerryLink/dsh-mcp-panel) | केवल-पढ़ने MCP रनटाइम पैनल: /mcp कमांड + स्थिति, टूल और त्रुटियों वाला Settings टैब |
| [dsh-doublecheck](https://github.com/PerryLink/dsh-doublecheck) | इंजीनियरिंग-अनुशासन गार्ड: आवश्यकताओं की पूछताछ, टेस्ट गेट, प्रतिद्वंद्वी समीक्षा |
| [dsh-background-agents](https://github.com/PerryLink/dsh-background-agents) | Web UI साइडबार, संदेश और इंटरप्ट के साथ टिकाऊ बैकग्राउंड चाइल्ड एजेंट |
| [dsh-lsp-actions](https://github.com/PerryLink/dsh-lsp-actions) | language servers पर LSP डायग्नोस्टिक्स, फ़ॉर्मेटिंग, कम्प्लीशन, कोड एक्शन और नाम बदलना |
| [dsh-output-styles](https://github.com/PerryLink/dsh-output-styles) | Claude Code outputStyles के समतुल्य रनटाइम स्टाइल स्विचिंग |
| [dsh-checkpoint-rewind](https://github.com/PerryLink/dsh-checkpoint-rewind) | Claude Code /rewind के समतुल्य: स्नैपशॉट, सत्र फ़ोर्क, एक-चरण रीस्टोर |
| [dsh-permission-rules](https://github.com/PerryLink/dsh-permission-rules) | ऑडिट के साथ Claude Code-शैली घोषणात्मक allow/deny/ask अनुमति नियम |
| [dsh-auto-review](https://github.com/PerryLink/dsh-auto-review) | अनुमोदन श्रृंखला पर द्वितीय-मॉडल ऑटो-रिव्यू, डिफ़ॉल्ट रूप से fail-closed |
| [dsh-memento](https://github.com/PerryLink/dsh-memento) | अनुमोदन-गेटेड क्रॉस-सत्र याद: ctx.memory सीम + SQLite + याद टूल |
| [dsh-skill-pack-security](https://github.com/PerryLink/dsh-skill-pack-security) | सुरक्षा-ऑडिट कौशल पैक: गोपनीय स्कैन, निर्भरता और आपूर्ति-श्रृंखला समीक्षा |
| [dsh-session-pin](https://github.com/PerryLink/dsh-session-pin) | टिकाऊ क्रम के साथ वेब साइडबार में सत्र पिन करें |
| [dsh-composer-history](https://github.com/PerryLink/dsh-composer-history) | वेब composer के लिए टर्मिनल-शैली इनपुट इतिहास: तीर, Ctrl+R खोज |
| [dsh-github](https://github.com/PerryLink/dsh-github) | DSH के लिए GitHub PR/issues एकीकरण, हर लेखन अनुमोदन-गेटेड |
| [dsh-plugin-guide](https://github.com/PerryLink/dsh-plugin-guide) | ऑन-डिमांड एजेंट कौशल के रूप में प्लगइन-विकास ज्ञानकोश |
| **[dsh-claude-move](https://github.com/PerryLink/dsh-claude-move)** | Claude Code सत्र, याद, कौशल और CLAUDE.md को DSH में माइग्रेट करें |

## लाइसेंस

[Apache License 2.0](LICENSE) © 2026 dsh-claude-move contributors
