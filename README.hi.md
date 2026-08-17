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

| सतह | स्थिति |
|---|---|
| Harness | DeepSeek Harness `0.1.0-rc.6` (peers `0.1.0-rc.6` पर पिन किए गए) |
| Node | `^22.19.0 \|\| >=24.0.0` |
| प्लेटफ़ॉर्म | सभी (होस्ट टूल + फ़्लोटिंग वेब पैनल; केवल सार्वजनिक सीम) |
| मॉडल | कोई भी (आयात नियतात्मक हैं; अपनी ओर से कोई मॉडल कॉल नहीं) |

## आपको क्या मिलता है

1. **स्वतः-खोज** — `claude_scan` Claude डेटा रूट (`$CLAUDE_CONFIG_DIR`, fallback `~/.claude`) खोजता है और हर प्रोजेक्ट/सत्र, याद, कौशल, वैश्विक `CLAUDE.md` और `settings.json` को इंडेक्स करता है, वृद्धिशील कैश और समानांतर स्कैनिंग के साथ।
2. **पूर्ण-निष्ठा आयात** — `import_claude` ट्रांसक्रिप्ट को संतुलित, फिर-से-शुरू होने योग्य DSH सत्रों में बदलता है, बाधित टूल कॉल की मरम्मत करता है, और `maxTranscriptBytes` से बड़ी ट्रांसक्रिप्ट को खंडों में स्ट्रीम-आयात करता है।
3. **एक `claudecode` वर्कस्पेस** — हर आयातित सत्र एक समर्पित वर्कस्पेस में जाता है (डिफ़ॉल्ट `$DSH_HOME/claudecode`); `workspaceMode: 'per-project'` प्रति-प्रोजेक्ट समूहन बहाल करता है।
4. **केवल-कॉपी और वृद्धिशील** — किसी भी तरफ कुछ भी स्थानांतरित, दोबारा लिखा या हटाया नहीं जाता; फिर चलाने पर केवल नए टर्न जोड़े जाते हैं।
5. **व्यक्तिगत संदर्भ, हमेशा ताज़ा** — यादें लाइव प्रॉम्प्ट अनुभाग के रूप में इंजेक्ट होती हैं, Claude कौशल वास्तविक DSH कौशल के रूप में पंजीकृत होते हैं, वैश्विक + प्रोजेक्ट `CLAUDE.md` जल्दी इंजेक्ट होता है।
6. **चार-स्रोत माइग्रेशन विज़ार्ड** — `/move` विज़ार्ड और `move_detect` / `move_preview` / `move_run` टूल Claude Code, Codex, OpenCode और Hermes को माइग्रेट करते हैं: यादें प्रबंधित `AGENTS.md` अनुभाग बनती हैं, कौशल DSH कौशल बनते हैं, स्लैश कमांड DSH कमांड बनते हैं, सत्र फिर-से-शुरू DSH सत्र बनते हैं — अनुमोदन-गेटेड और आइडेम्पोटेंट (`move.json`)।
7. **वेब पैनल और कमांड** — `/claude-import-all`, `/resume-claude`, `/claude-move-reset`, और प्रगति, रद्द, पेजिंग और "सत्र खोलें" वाला फ़्लोटिंग माइग्रेशन पैनल।

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
- **अनइंस्टॉल**: प्रोफ़ाइल के bundles से `claude-move` पंक्ति हटाएँ और `dsh` पुनः प्रारंभ करें। आयातित सत्र बने रहते हैं; प्लगइन केवल अपना कैश (`$DSH_HOME/claude-move/`) और `claudecode` वर्कस्पेस फ़ोल्डर लिखता है, और Claude स्रोत डेटा को कभी नहीं छूता।

## कॉन्फ़िगरेशन

सब वैकल्पिक, cordis.yml में ओवरराइड योग्य।

| कुंजी | डिफ़ॉल्ट | अर्थ |
|---|---|---|
| `claudeHome` | `$CLAUDE_CONFIG_DIR` या `~/.claude` | Claude डेटा रूट |
| `workspaceMode` | `claudecode` | `claudecode` (एक समर्पित वर्कस्पेस) · `per-project` (प्रति स्रोत cwd एक वर्कस्पेस) |
| `claudecodeDir` | `$DSH_HOME/claudecode` | `claudecode` वर्कस्पेस फ़ोल्डर (प्लगइन द्वारा बनाया जाने वाला एकमात्र फ़ोल्डर) |
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
| `importConcurrency` | `4` | प्रति बैच समानांतर पढ़ + रूपांतरण |
| `requireApproval` | `true` | विज़ार्ड लेखन `ctx.approval` माँगते हैं (केवल allowed-once) |
| `codexHome` | `$CODEX_HOME` या `~/.codex` | Codex डेटा रूट |
| `opencodeDataHome` | प्लेटफ़ॉर्म XDG डेटा dir/opencode | OpenCode डेटा रूट |
| `opencodeConfigHome` | प्लेटफ़ॉर्म XDG कॉन्फ़िग dir/opencode | OpenCode कॉन्फ़िग रूट |
| `hermesHome` | `$HERMES_HOME` या `~/.hermes` | Hermes डेटा रूट |
| `skillsDir` | `$DSH_HOME/skills` | विज़ार्ड कौशल लक्ष्य |
| `agentsMdPath` | `$DSH_HOME/AGENTS.md` | विज़ार्ड याद/निर्देश लक्ष्य |
| `moveWorkspaceMode` | `per-source` | विज़ार्ड आयात का वर्कस्पेस समूहन: `per-source` · `single` |

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
- **लिखता है** सार्वजनिक `sessionPersistence` सेवा से DSH सत्र लॉग (केवल create + append, कभी हटाए/दोबारा लिखे/संग्रहीत नहीं), वर्कस्पेस-रजिस्ट्री रिकॉर्ड, `$DSH_HOME/claude-move/` के अंतर्गत अपना कैश, और `claudecode` वर्कस्पेस फ़ोल्डर।
- **कभी नहीं** Claude स्रोत फ़ाइलों को बदलता, अन्य ऐप्स के डेटा को छूता, या नेटवर्क उपयोग करता। **कोई** क्रेडेंशियल नहीं पढ़ा या भेजा जाता।

## सुरक्षा सीमाएँ

- **स्रोत फ़ाइलें केवल-पढ़ने; DSH लॉग केवल-append** (केवल `create` + `append`)।
- **बाहरी ट्रांसक्रिप्ट अविश्वसनीय इनपुट हैं** — उनमें कुछ भी निष्पादित नहीं होता; system/developer/thinking सामग्री कभी रिज़्यूम हैंडऑफ़ में नहीं जाती।
- **केवल सार्वजनिक सेवाएँ** — `sessionPersistence` / `workspaceRegistry` / `tools` / `commands` / `systemPrompt` / `skills` / `webServer`; इंजन या UI में कोई बदलाव नहीं।
- **गोपनीय जानकारी केवल स्थान से सूचित** होती है; `permission`/`permission-mode`/`queue-operation` रिकॉर्ड गिने जाते हैं, आयात नहीं किए जाते।
- **विज़ार्ड लेखन अनुमोदन-गेटेड** — `allowed-once` के अलावा कुछ भी होने पर शून्य लेखन।

## ज्ञात सीमाएँ

- शीर्षक `custom-title`/`ai-title`/पहले प्रॉम्प्ट से आते हैं; Claude `summary` रिकॉर्ड सूचित होते हैं पर DSH कम्पैक्शन नोड में मैप नहीं होते।
- `thinking` ब्लॉक `reasoning` सामग्री के रूप में रखे जाते हैं, पर कभी रिज़्यूम हैंडऑफ़ में नहीं जाते।
- बाधित टूल कॉल सिंथेटिक त्रुटि परिणाम से मरम्मत होते हैं (`repaired.synthesized` के रूप में सूचित)।
- स्ट्रीमिंग `fs.streamText` सतह के बिना होस्ट पर, `maxTranscriptBytes` से बड़ी ट्रांसक्रिप्ट आंशिक आयात के बजाय ज़ोर से विफल होती हैं।
- `workspaceMode: 'per-project'` में, जिन सत्रों की स्रोत निर्देशिका हटा दी गई थी वे फिर भी आयात होते हैं पर वर्कस्पेस जुड़ाव विफल रहता है (बिना समूह के छूट जाते हैं)। डिफ़ॉल्ट `claudecode` वर्कस्पेस स्रोत निर्देशिका पर निर्भर नहीं करता।
- वेब पैनल प्लगइन के अपने JSON मार्गों से चलने वाला शून्य-बिल्ड फ़्लोटिंग पैनल है।

## विकास

```sh
npm install   # peer deps: @deepseek-ai/dsh-tools@0.1.0-rc.6, @deepseek-ai/cordis, schemastery
npm test      # node --test test/*.test.mjs
```

## विषय

`deepseek-harness`, `dsh-plugin`, `claude-code`, `migration`, `session-import`, `resume`

## योगदानकर्ता

- [@PerryLink](https://github.com/PerryLink) — निर्माता और अनुरक्षक: आयात पाइपलाइन, चार-स्रोत माइग्रेशन विज़ार्ड, वेब पैनल, दस्तावेज़, CI/CD और रिलीज़।
- [@OLDnana1](https://github.com/OLDnana1) — बाधित टूल-कॉल भ्रष्टाचार का मूल-कारण विश्लेषण, जिसके कारण आयातित सत्र रिज़्यूम पर स्थायी रूप से HTTP 400 लौटाते थे।
- [@GooodWei](https://github.com/GooodWei) — पहचाना कि `README.md` (और कोई भी विवरण-रहित `.md`) गलती से कौशल के रूप में पंजीकृत हो जाता था, जिससे DSH का कौशल लोड टूट जाता था।

## लाइसेंस

[Apache License 2.0](LICENSE) © 2026 dsh-claude-move contributors
