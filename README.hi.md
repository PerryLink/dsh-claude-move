# dsh-claude-move

**Claude Code → DeepSeek Harness: पूर्ण माइग्रेशन + निर्बाध निरंतरता।**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Topic: dsh-plugin](https://img.shields.io/badge/topic-dsh--plugin-3fb950)](https://github.com/topics/dsh-plugin)

[English](README.md) | [中文](README.zh.md) | [Español](README.es.md) | [Português](README.pt.md) | हिन्दी

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) के लिए एक प्लगइन। इंस्टॉल करते ही यह आपके स्थानीय Claude Code की सारी सामग्री — सत्र ट्रांसक्रिप्ट, यादें (memories), कौशल (skills), वैश्विक निर्देश, सेटिंग्स और प्रोजेक्ट की स्थिति — अपने आप खोज लेता है, और «इतिहास + व्यक्तिगत संदर्भ» को DSH में ले आता है, ताकि आप अपने Claude Code सत्रों को DeepSeek Harness के अंदर **बिना किसी रुकावट के जारी** रख सकें।

> स्थिति: विकासाधीन (चरण 5/6 — वेब पैनल लागू)। रोडमैप और डिज़ाइन: [PLAN.md](PLAN.md)।

## यह क्या करता है

- **स्वतः खोज (auto-discovery)**: Claude का डेटा रूट (`$CLAUDE_CONFIG_DIR`, डिफ़ॉल्ट `~/.claude`) ढूँढता है, हर प्रोजेक्ट/सत्र (शीर्षक, समय, संदेश व टूल-कॉल गिनती), डायरेक्टरी और git की स्थिति (ब्रांच, बदली फ़ाइलें), यादें, कौशल, वैश्विक `CLAUDE.md` और `settings.json` को अनुक्रमित करता है। वृद्धिशील कैश: सिर्फ़ बदली फ़ाइलें दोबारा पढ़ी जाती हैं।
- **इतिहास आयात**: पूर्ण-विश्वसनीय इवेंट मैपिंग (`turn/start → step/start → user/message → assistant/message → tool/call → tool/result → step/end → turn/end`), जिससे **संतुलित और फिर-से-शुरू (resume) होने योग्य DSH सत्र** बनते हैं, जो मूल प्रोजेक्ट वर्कस्पेस से जुड़े होते हैं। आइडेम्पोटेंट, बैच, बलपूर्वक पुनः-आयात, ख़राब पंक्तियों की पंक्ति-संख्या सहित रिपोर्ट।
- **व्यक्तिगत संदर्भ हमेशा ताज़ा**: यादें सिस्टम-प्रॉम्प्ट के गतिशील खंड के रूप में इंजेक्ट होती हैं (हर अनुरोध पर दोबारा पढ़ी जाती हैं), Claude के कौशल असली DSH कौशल बन जाते हैं, और वैश्विक तथा प्रोजेक्ट-स्तरीय `CLAUDE.md` शुरुआती खंड के रूप में जुड़ते हैं (प्रोजेक्ट को प्राथमिकता)। `settings.json` को DSH कॉन्फ़िगरेशन सुझावों में अनुवादित किया जाता है।

## रोडमैप

| चरण | दायरा | स्थिति |
| --- | --- | --- |
| 1 | स्वतः खोज + `claude_scan` टूल + वृद्धिशील कैश | ✅ |
| 2 | इतिहास आयात (`import_claude`: मैपिंग, आइडेम्पोटेंसी, बैच, बलपूर्वक पुनः-आयात, पंक्ति-संख्या त्रुटियाँ, वर्कस्पेस जुड़ाव) | ✅ |
| 3 | व्यक्तिगत संदर्भ (यादें इंजेक्शन, Claude कौशल प्रदाता, CLAUDE.md खंड, सेटिंग्स अनुवाद) | ✅ |
| 4 | एक-चरण कमांड `/claude-import-all` व `/resume-claude` (हैंडऑफ़ सारांश + सुरक्षा मॉडल) | ✅ |
| 5 | वेब UI «Claude माइग्रेशन» पैनल (`dsh.client`) | ✅ |
| 6 | रिलीज़ तैयारी: द्विभाषी दस्तावेज़, आर्किटेक्चर आरेख, पैकेजिंग, डेमो | 🚧 |

## इंस्टॉलेशन

```sh
# GitHub से
dsh plugin --profile web add -w github:PerryLink/dsh-claude-move

# स्थानीय चेकआउट (विकास हेतु)
dsh plugin --profile web add -w link:/path/to/dsh-claude-move

# पैक किए गए tarball से
dsh plugin --profile web add -w ./dsh-claude-move-0.1.0.tgz
```

पैकेज शुद्ध ESM है और इसमें कोई बिल्ड चरण नहीं है, इसलिए Git से इंस्टॉल में `prepare` स्क्रिप्ट या `allowBuilds` प्रविष्टि की ज़रूरत नहीं। आधिकारिक [पैकेजिंग व इंस्टॉल गाइड](https://deepseek-harness.github.io/deepseek-harness/develop/basic/publish) देखें।

## उपयोग

प्लगइन माउंट होने पर किसी भी सत्र में टूल बुलाएँ:

```
claude_scan                          # पूर्ण स्कैन (वृद्धिशील कैश)
claude_scan { path: "~/.claude/projects/<slug>" }   # आंशिक स्कैन
claude_scan { refresh: true }        # कैश छोड़कर पूरा दोबारा स्कैन

import_claude { path: "~/.claude/projects/<slug>/<sessionId>.jsonl" }  # एक सत्र
import_claude { path: "~/.claude/projects" }        # डायरेक्टरी (पुनरावर्ती)
import_claude { path: "all" }                       # सब कुछ
import_claude { path: "...", force: true }          # पुराना आयात संग्रहित कर import-<src>-<n> के रूप में पुनर्निर्माण
```

कमांड (उपयोगकर्ता द्वारा चलाए जाते हैं, मॉडल टर्न नहीं):

```
/claude-import-all                # एक चरण: स्कैन → आयात → रिपोर्ट → वर्तमान सत्र में इंजेक्ट
/resume-claude latest             # सबसे हाल का Claude सत्र जारी करें
/resume-claude <sessionId>        # स्रोत सत्र id या import-<src> id से
/resume-claude <कीवर्ड>           # शीर्षक से मिलान; कई मिलान सूचीबद्ध होते हैं, अंदाज़ा कभी नहीं
```

वेब पैनल: नीचे-दाएँ तैरता **🐳 Claude 迁移** बटन पैनल खोलता है — प्रोजेक्ट/सत्र ट्री (स्थिति बैज: आयात नहीं / आयातित / स्रोत अनुपलब्ध / डायरेक्टरी मौजूद नहीं / git गंदा), कीवर्ड फ़िल्टर, प्रति-सत्र «आयात करें और जारी रखें» + «सत्र सूची ताज़ा करें», और लाइव प्रोग्रेस बार के साथ बैच आयात। डेटा प्लगइन की अपनी `/api/claude-move/*` JSON रूट्स से आता है (सार्वजनिक `ctx.webServer` seam)।

- **स्कैन** एक संरचित JSON अनुक्रमणिका लौटाता है: प्रोजेक्ट (slug/cwd/डायरेक्टरी की मौजूदगी/git ब्रांच व बदली फ़ाइलें), सत्र (शीर्षक/समय/गिनतियाँ/ख़राब पंक्तियाँ), यादें, कौशल, वैश्विक CLAUDE.md व settings.json; हर सत्र में `import.status` (`none`/`imported`/`source-missing`) होता है। `settingsSuggestions` में settings.json का DSH अनुवाद और अनमैप-योग्य कुंजियाँ होती हैं (देखें [COMPLIANCE.md](COMPLIANCE.md))।
- **आयात** user/assistant/tool/thinking संदेशों को पूरी विश्वसनीयता से मैप करता है; परिणाम एक संतुलित, फिर-से-शुरू होने योग्य सत्र होता है जो `cwd` द्वारा अपने वर्कस्पेस से जुड़ा होता है। बैच फ़ाइल-दर-फ़ाइल सारांश देता है (`imported`/`already-imported`/`skipped`/`failed`), ख़राब पंक्तियाँ पंक्ति-संख्या के साथ आती हैं, संदिग्ध सीक्रेट केवल स्थान से बताए जाते हैं (फ़ाइल:पंक्ति:प्रकार) और अनुमति-श्रेणी रिकॉर्ड गिने जाते हैं, आयात कभी नहीं होते।
- **व्यक्तिगत संदर्भ अपने आप लागू होता है** (कोई आयात क्रिया ज़रूरी नहीं):
  - यादें: सभी `projects/*/memory/*.md` गतिशील खंड के रूप में इंजेक्ट होते हैं, हर अनुरोध पर दोबारा पढ़े जाते हैं (नई यादें तुरंत लागू), क्रम `feedback > project > reference > user`, डिफ़ॉल्ट सीमा 8 KiB।
  - कौशल: `~/.claude/skills/**/SKILL.md` (साथ में सपाट `*.md`) DSH कौशल बन जाते हैं (नाम kebab-case में, टकराव पर प्रत्यय, अधिकतम 30); कैटलॉग और `skill` टूल DSH का काम है।
  - निर्देश: वैश्विक `~/.claude/CLAUDE.md` और वर्तमान सत्र का `.claude/CLAUDE.md` शुरुआती खंड के रूप में इंजेक्ट होते हैं (प्रोजेक्ट को प्राथमिकता)।

## कॉन्फ़िगरेशन

सब वैकल्पिक, `cordis.yml` में बदले जा सकते हैं:

```yaml
- id: claude-move
  name: dsh-claude-move
  config:
    claudeHome: null            # डिफ़ॉल्ट: $CLAUDE_CONFIG_DIR या ~/.claude
    scanGit: true               # git ब्रांच व बदलाव की स्थिति जाँचें
    maxTranscriptBytes: 67108864
    excludeProjects: []         # छोड़ने योग्य slug उप-स्ट्रिंग, जैसे ['demo-']
    enableMemory: true
    memoryMaxBytes: 8192
    enableSkills: true
    maxSkills: 30
    extraSkillDirs: []
    enableInstructions: true
    resumeMaxChars: 2048      # हैंडऑफ़ सारांश की वर्ण सीमा
    enableWebPanel: true      # /api/claude-move/* रूट्स पंजीकृत करें
```

## अनइंस्टॉल

प्रोफ़ाइल के bundles से `claude-move` पंक्ति हटाकर `dsh` दोबारा चलाएँ। आयातित सत्र DSH के डेटा डायरेक्टरी में बने रहते हैं; प्लगइन केवल अपना कैश (`$DSH_HOME/claude-move/`) लिखता है और Claude के स्रोत डेटा को कभी नहीं छूता।

## सुरक्षा सीमाएँ

- स्रोत फ़ाइलें पूरी तरह केवल-पठनीय हैं; DSH सत्र लॉग केवल-जोड़ (append-only) हैं (सिर्फ़ `create` + `append`)।
- बाहरी ट्रांसक्रिप्ट अविश्वसनीय इनपुट हैं: उनकी कोई सामग्री निष्पादित नहीं होती; system/developer/thinking सामग्री कभी हैंडऑफ़ सारांश में नहीं जाती।
- DSH इंजन, आधिकारिक UI पैकेज या apiproxy में कोई बदलाव नहीं — केवल सार्वजनिक सेवाएँ (`sessionPersistence` / `workspaceRegistry` / `tools` / `commands` / `systemPrompt` / `skills` / `webServer`)।
- संदिग्ध सीक्रेट केवल स्थान से बताए जाते हैं (सामग्री कभी नहीं); `permission`/`permission-mode`/`queue-operation` रिकॉर्ड गिने जाते हैं, आयात नहीं होते।

## अनुपालन और अनुकूलन

- [COMPLIANCE.md](COMPLIANCE.md) — आधिकारिक प्लगइन प्रतिबंधों के विरुद्ध खंड-दर-खंड ऑडिट (deepseek-harness रेपो व दस्तावेज़, [deepseek.com/harness](https://www.deepseek.com/harness/), [डेवलपर दस्तावेज़](https://deepseek-harness.github.io/deepseek-harness/develop/basic/), [Cordis](https://github.com/cordiverse/cordis) और [Cordis पेपर](https://github.com/cordiverse/paper))।
- [OPTIMIZATION.md](OPTIMIZATION.md) — मापी गई आधार-रेखाएँ और प्राथमिकता-क्रम में अनुकूलन उम्मीदवार (समानांतर स्कैन/आयात, gitBranch पुनर्उपयोग, स्ट्रीमिंग आयात, वृद्धिशील सिंक मोड…)।
- [ARCHITECTURE.md](ARCHITECTURE.md) — आर्किटेक्चर आरेख और पूर्ण डेटा-मैपिंग तालिका।
- [RELEASE.md](RELEASE.md) — स्वीकृति प्रमाण सहित रिलीज़ चेकलिस्ट।

## स्रोत-श्रेय (MIT पारिस्थितिकी)

- रूपांतरण केंद्र vendored: [Nwflower/dsh-chat-import](https://github.com/Nwflower/dsh-chat-import) (MIT)।
- खोज परिपाटियाँ व सुरक्षा मॉडल: [Demogorgon314/dsh-resume-plugin](https://github.com/Demogorgon314/dsh-resume-plugin) (MIT; इसका `session_reader.py` Apache-2.0 मूल का है — देखें [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md))।
- यादें/कौशल इंजेक्शन व frontmatter पार्सिंग पैटर्न: [YYTbit/dsh-plugin-claude-bridge](https://github.com/YYTbit/dsh-plugin-claude-bridge) (MIT)।

## विकास

```sh
npm install   # peer deps: @deepseek-ai/cordis, @deepseek-ai/dsh-tools@0.1.0-rc.6, @deepseek-ai/schemastery
npm test      # node --test: convert (vendored + विस्तारित), discovery, import/report, context, settings
```

## मॉडल अनुभव

- मॉडल को दिखने वाली सतह दो टूल्स के description/schema और उनके आउटपुट हैं: `claude_scan` संरचित अनुक्रमणिका लौटाता है, `import_claude` फ़ाइल-दर-फ़ाइल सारांश और चेतावनियों की स्थिति देता है। टूल परिणाम स्वयं दर्ज `tool/result` इवेंट होते हैं, इसलिए सब कुछ पुनर्निर्माण-योग्य है।
- मॉडल के लिए कोई छिपा हुआ टेक्स्ट नहीं; memory/CLAUDE.md खंड `ctx.systemPrompt` पर पंजीकृत होते हैं (प्रॉम्प्ट असेंबली, सत्र लॉग से पुनर्निर्माण-योग्य)।

## ज्ञात सीमाएँ

- शीर्षक `custom-title`/`ai-title`/पहले संदेश से लिए जाते हैं; Claude के `summary` रिकॉर्ड शीर्षक नहीं बनते।
- `thinking` ब्लॉक आयातित लॉग में `reasoning` सामग्री के रूप में रहते हैं, पर हैंडऑफ़ सारांश में कभी नहीं जाते।
- अनुमति-श्रेणी रिकॉर्ड गिने जाते हैं, आयात नहीं होते; रिपोर्टों में DSH अनुमति सुझाव बनाए जाते हैं।
- `maxTranscriptBytes` से बड़े ट्रांसक्रिप्ट आंशिक आयात के बजाय स्पष्ट विफलता देते हैं (विश्वसनीयता पहले); ब्लॉक-आधारित स्ट्रीमिंग आयात रोडमैप पर है।
- जिन सत्रों की स्रोत डायरेक्टरी हट चुकी है वे फिर भी आयात होते हैं, पर वर्कस्पेस जुड़ाव विफल रहता है (असमूहीकृत रहते हैं; रिपोर्ट में `workspace.attached: false`)।
- बीच में रुके बैच आयात सुरक्षित रूप से दोबारा चलाए जा सकते हैं (आइडेम्पोटेंट, केवल-जोड़)।
- वेब पैनल एक बिना-बिल्ड तैरता पैनल है जो प्लगइन की अपनी JSON रूट्स से चलता है; यह shell की आंतरिक UI slot प्रणाली का उपयोग नहीं करता (rc.6 के अदस्तावेज़ीकृत आंतरिक भागों से स्वतंत्र)।

## संबंधित लिंक

- DeepSeek Harness: [रेपो](https://github.com/deepseek-ai/deepseek-harness) · [साइट](https://www.deepseek.com/harness/) · [डेवलपर दस्तावेज़](https://deepseek-harness.github.io/deepseek-harness/develop/basic/)
- प्लगइन पारिस्थितिकी: [`dsh-plugin` टॉपिक](https://github.com/topics/dsh-plugin) · [Discord](https://discord.gg/Ycq5dCaS4)

## लाइसेंस

MIT — देखें [LICENSE](LICENSE)। तृतीय-पक्ष सूचनाएँ [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) में।
