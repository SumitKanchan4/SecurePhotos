# Local AI photo restoration and colorization: product UX, Windows deployment and licensing/legal (as of Nov 2026)

Scope: SecurePhotos (Windows desktop, Tauri + local Python engine, ONNX Runtime + DirectML, offline, bundled models). Individual developer, MIT-licensed code. Research date: 2026-11-15. Not legal advice.

## UX: how leading apps present restoration and colorization (auto vs on demand, originals, compare, strength, labels/metadata)

### Takeaway
Every product researched runs restoration on demand, keeps the original as a separate version, and gives at least a before/after comparison. The more professional tools add strength sliders and face selection. Labelling ranges from visible badges (MyHeritage) to metadata only: an EXIF credit (Apple), IPTC digital source type plus C2PA (Google). The IPTC vocabulary already has the right terms: `algorithmicallyEnhanced` for non-generative fixes and `compositeWithTrainedAlgorithmicMedia` for generative face reconstruction and colorization.

### Cited Findings
**MyHeritage Photo Enhancer / In Color**
- The original stays intact. The enhanced photo "piggybacks" on it and keeps its title, date, place and tags. MyHeritage says originals "should not be modified or replaced". Users can download the original, the enhanced version or a side-by-side comparison. Deleting the original also deletes the enhanced version. — [MyHeritage blog, Introducing the Photo Enhancer (2020)](https://blog.myheritage.com/2020/06/introducing-the-myheritage-photo-enhancer/)
- Comparison: on the web you drag a slider across the image or toggle with buttons; the mobile app uses a centre slider bar. A bar under the photo shows each detected face, and clicking one zooms in on its enhancement. The tool does not always detect every face. — [MyHeritage blog](https://blog.myheritage.com/2020/06/introducing-the-myheritage-photo-enhancer/)
- Visible labelling: enhanced photos get a magic-wand symbol in the bottom-left corner and colorized photos get a palette symbol, "to inform others that a photo has been artificially enhanced". Non-subscribers also get a MyHeritage logo watermark at the bottom right. — [MyHeritage blog](https://blog.myheritage.com/2020/06/introducing-the-myheritage-photo-enhancer/)
- Photos whose colours were only *restored* (faded colour, not B&W colorization) get no symbol. — [MyHeritage blog, Improved Color Restoration (2022)](https://blog.myheritage.com/2022/01/improved-color-restoration-for-photos-on-myheritage/) (as summarised in search results; not fetched in full)
- Disclaimer copy: "since the enhancement is a simulation, done by algorithms, its results may be inaccurate and, in rare cases, even distorted"; the technology "infers what the original faces may have looked like"; enhancing plus colorizing gives "a reimagination" of the scene. The technology is described as licensed deep learning; no vendor is named. — [MyHeritage blog](https://blog.myheritage.com/2020/06/introducing-the-myheritage-photo-enhancer/)
- A Hugging Face mirror of DeOldify links MyHeritage In Color as "the commercial version" (DeOldify's author partnered with MyHeritage). — [HF DeOldify mirror README](https://huggingface.co/thookham/DeOldify/blob/main/README.md)
- Current help page: [MyHeritage Help, Photo Enhancer](https://www.myheritage.com/help/en/articles/12852484-what-is-and-how-do-i-use-the-myheritage-photo-enhancer) (not fetched). Flag: the 2020 blog is old, so watermark and pricing rules may have changed.

**Adobe Photoshop Neural Filters (Photo Restoration, Colorize) and Lightroom Enhance**
- Photo Restoration lives at Filter > Neural Filters > Photo Restoration. Its sliders are Photo enhancement, Enhance face and Scratch reduction, and Scratch reduction is off by default. Colorize is a separate filter. Most Neural Filters run locally and need a fairly recent machine. — [Adobe Neural Filters list and FAQ](https://helpx.adobe.com/gr_en/photoshop/using/neural-filters-list-and-faq.html); [CreativePro review](https://creativepro.com/using-the-photo-restoration-neural-filter-in-photoshop/); [Adobe old-photo restoration page](https://www.adobe.com/products/photoshop/old-photo-restoration.html)
- CreativePro's review found the restoration filter is "not yet a replacement for a professional retoucher". — [CreativePro](https://creativepro.com/using-the-photo-restoration-neural-filter-in-photoshop/)
- Neural Filters can write output to a new layer, a smart filter or a new document, which is non-destructive within Photoshop. (This is from my background knowledge of the filter's output options; the FAQ page was not fetched to confirm it.)
- Lightroom Enhance (Denoise, Super Resolution) never changes the source. It writes a new DNG next to it, for example `Original filename-Enhanced-RD.DNG` / `-Enhanced-NR.dng`, and stacks it with the source. Super Resolution doubles width and height. An image that has already been enhanced cannot be enhanced again. — [Adobe Help, Enhance details](https://helpx.adobe.com/lightroom-cc/using/enhance-details.html); [Lightroom Classic Enhance](https://helpx.adobe.com/lightroom-classic/desktop/help/enhance-details-alt.html)
- Lightroom reads embedded XMP to block a second enhancement pass. A community thread reports it refused Super Resolution on a TIFF made from a denoised DNG. — [Adobe community thread](https://community.adobe.com/t5/bug-lightroom-classic/re:-lrc-enhance-no-longer-allows-super-resolution-on-tiff-files./idi-p/15303360)

**Topaz Photo AI, Recover Faces**
- On import, Photo AI scans for faces. With Autopilot on, Recover Faces is applied automatically whenever faces are found; otherwise you add it by hand. Strength is set in the Controls tab. Yellow rectangles mark faces that will be affected and grey ones faces that won't (selected vs not). Undetected faces cannot be forced. There are global "Hair and Neck" part toggles. The docs warn of a "plastic" look on high-resolution portraits and artifacts on out-of-focus faces. — [Topaz docs, Recover Faces](https://docs.topazlabs.com/photo-ai/enhancements/recover-faces)
- Topaz's developer docs say the model reconstructs "plausible features rather than strictly preserving original pixels" when facial information is missing. — [Topaz developer, Recover Faces](https://developer.topazlabs.com/image-models/gigapixel/recover-faces)

**Remini**
- Described as one-tap cloud enhancement for mobile and web with few controls, in contrast to Topaz's detailed controls. This comes from a third-party comparison, not a primary source. — [ProVideo Coalition](https://www.provideocoalition.com/ai-photo-enhancement-software/)

**Google Photos**
- Google Photos is adding C2PA Content Credentials to edited images. Reportedly it pairs them with the IPTC digital source type: "computational capture" on ordinary photos and "Edited using Generative AI" on Magic Editor / Reimagine edits. — [billo.app summary (secondary)](https://billo.app/blog/ai-labeling/); [IPTC news: Google AI transparency based on IPTC standards](https://iptc.org/news/google-ai-transparency-based-on-iptc-standards/)
- A 2024 APK teardown found `compositeWithTrainedAlgorithmicMedia` in Google Photos, to be used when an image is "corrected or enhanced using a Generative AI model". This was code, not a live feature, at the time. — [Android Authority teardown](https://www.androidauthority.com/google-photos-ai-generated-image-metadata-apk-teardown-3489044)
- The "Help me edit" prompt editor reached India, Australia and Japan in Jan 2026 after a US launch (adults 18+). — [TechCrunch, 2026-01-27](https://techcrunch.com/2026/01/27/google-photos-brings-its-prompt-based-editing-feature-to-india-australia-and-japan/); [Google blog](https://blog.google/products-and-platforms/products/photos/ai-photo-editing-google-photos/)

**Apple Photos**
- Clean Up writes "Apple Photos Clean Up" / "Modified with Clean Up" into EXIF metadata (the Credit field) and shows it in the Photos info panel. The label survives AirDrop and iMessage but is stripped by WhatsApp and Telegram. — [9to5Mac](https://9to5mac.com/2024/08/28/ios-18-1-labels-images-clean-up); [iDownloadBlog](https://www.idownloadblog.com/?p=1010670)
- Apple frames its photo AI as "accuracy over fantasy". — [TechRadar](https://www.techradar.com/phones/iphone/accuracy-over-fantasy-apple-explains-why-its-ai-photo-editing-isnt-as-incredible-as-googles-or-samsungs)
- In June 2026 Apple announced AI reframing and editing tools for Photos. — [MacRumors, 2026-06-08](https://macrumors.com/2026/06/08/apple-ai-reframing-and-editing-tools-in-photos) (not fetched; details unverified)

**IPTC digital source type vocabulary (primary)**
- `trainedAlgorithmicMedia`: "Digital media created algorithmically using an Artificial Intelligence model trained on captured content". — [IPTC NewsCodes DigitalSourceType](https://cv.iptc.org/newscodes/digitalsourcetype/)
- `compositeWithTrainedAlgorithmicMedia`: "Augmentation, correction or enhancement using a Generative AI model, such as with inpainting or outpainting operations". — [IPTC](https://cv.iptc.org/newscodes/digitalsourcetype/)
- `algorithmicallyEnhanced`: "Modification or correction by algorithm without changing the main content of the media", initiated or configured by a human; examples are sharpening and noise reduction. — [IPTC](https://cv.iptc.org/newscodes/digitalsourcetype/)
- Also relevant: `print` (digitised from a photographic print), `negativeFilm`, `positiveFilm`, `composite`, `compositeSynthetic`, `computationalCapture`. — [IPTC](https://cv.iptc.org/newscodes/digitalsourcetype/)
- Google Search reads `compositeWithTrainedAlgorithmicMedia` from image file metadata, not from schema.org markup. — [SE Roundtable](https://seroundtable.com/google-search-new-iptc-digital-source-compositewithtrainedalgorithmicmedia-37694.html)

### Inferences
- Common pattern: on demand only (Topaz Autopilot is the one auto-apply exception, inside a pro tool) → output saved as a **new linked version**, never an overwrite (MyHeritage, Lightroom) → compare slider or toggle → per-face view or selection (MyHeritage, Topaz) → strength sliders (Adobe, Topaz) → disclaimer copy that says faces are "inferred".
- For SecurePhotos: store the restored or colorized result as a child version of the encrypted original, with one-tap revert and download of either. Show a small in-app badge (wand / palette, as MyHeritage does) on the version, and write IPTC `Iptc4xmpExt:DigitalSourceType` into exported files. Suggested mapping: scratch/denoise/upscale without face generation → `algorithmicallyEnhanced`; GAN/diffusion face restoration or B&W colorization → `compositeWithTrainedAlgorithmicMedia`. Also record the original medium (`print`) where known.
- C2PA signing needs a signing certificate. An individual developer can embed an unsigned or self-signed manifest, but validators will not show it as trusted. IPTC XMP is the cheap, widely read baseline. (This is an inference; C2PA trust-list requirements were not researched in this pass.)
- No product researched marks colour that was only *restored* (MyHeritage explicitly does not). Colorizing a B&W photo, by contrast, is consistently labelled.

### Gaps
- I could not confirm that Google Photos has a dedicated local "colorize" or "restore old photo" feature, or exactly what labels Google applies to such edits in 2026. The billo.app claim about a visible-label toggle from Aug 2026 is unverified.
- I found no primary docs on Remini's controls (for example a realism or "fidelity" slider) or its labelling.
- I did not confirm whether the current Photoshop Photo Restoration filter writes IPTC / C2PA metadata when Content Credentials is on. Adobe does attach Content Credentials to Firefly generative edits, but I did not verify this for Neural Filters.

## Identity and authenticity risks of face restoration, and mitigations

### Takeaway
Vendors openly say face restoration *invents* plausible detail (Topaz: "plausible features rather than strictly preserving original pixels"; MyHeritage: "infers what the original faces may have looked like"). Their mitigations are strength/fidelity sliders, per-face selection or zoom, keeping the original, and disclaimer copy. Users still complain about identity drift and ask for reference photos.

### Cited Findings
- Topaz says the reconstruction is plausible rather than faithful when information is missing. — [Topaz developer docs](https://developer.topazlabs.com/image-models/gigapixel/recover-faces)
- Topaz forum users complain that face recovery "changed the faces too much" and ask for reference-photo support so the person's identity is kept. — [Topaz community, reference photos request](https://community.topazlabs.com/t/enhancement-improvement-face-recovery-to-use-reference-photos/44942.md); [Topaz community, Gigapixel vs Remini](https://community.topazlabs.com/t/gigapixel-face-refinement-vs-remini/18501/25)
- Topaz recommends Recover Faces for small or low-resolution faces and advises against it for portraits. Over-processing gives a "plastic" look. — [Topaz docs](https://docs.topazlabs.com/photo-ai/enhancements/recover-faces); [Topaz Photo docs](https://docs.topazlabs.com/topaz-photo/enhancements/recover-faces)
- MyHeritage warns results "may be inaccurate and, in rare cases, even distorted" and offers per-face zoom. — [MyHeritage blog](https://blog.myheritage.com/2020/06/introducing-the-myheritage-photo-enhancer/)
- A reviewer notes that dots and damage can lead MyHeritage's face enhancer to "very disturbing results". — [Techlicious](https://techlicious.com/blog/my-heritage-photo-enhancer-colorizer)
- One guide notes that Gemini-style colorization gives plausible colours, not historically accurate ones. — [offshoreclipping blog (low authority)](https://offshoreclipping.com/blog/can-gemini-edit-photos/)
- Under the EU AI Act deepfake guidance, the test is objective: content qualifies if the subject is plausibly real, and intent to deceive is not required. — [Paul Weiss memo](https://www.paulweiss.com/insights/client-memos/eu-finalises-transparency-rules-for-ai-generated-content)

### Inferences
- Recommended SecurePhotos mitigations:
  - a fidelity control (CodeFormer-style `w` or a GFPGAN blend weight) that defaults to the *conservative* side;
  - a face-blend strength slider that alpha-blends the restored face back over the original;
  - a per-face list with on/off toggles and a zoomed compare for each face;
  - a "Faces changed: N" indicator on the version;
  - an option to skip faces larger than X px, following Topaz's own advice against using it on portraits;
  - disclaimer copy that says faces are reconstructed estimates.
- Never auto-apply face restoration in the background, for example while importing a library. Family-archive users care about likeness, and an invented face that silently replaces a grandparent's is the worst failure mode.
- Colorization should be presented as "one plausible colouring", with a strength or saturation slider and a way to go back to B&W.

### Gaps
- I found no quantitative studies of identity drift (for example face-recognition similarity before and after) in consumer products.
- Remini's mitigations were not verified.

## Licensing and legal: permissive weights trained on non-commercial data; EU AI Act Article 50

### Takeaway
Whether model weights are a derivative of their training data, and so bound by FFHQ's CC BY-NC-SA or ImageNet's non-commercial terms, is **unsettled law**. Practitioners mostly advise treating such weights as presumptively risky for commercial distribution. A free, non-monetised MIT app is lower-risk but not risk-free, because "non-commercial" is ambiguous and the app may later be monetised. CodeFormer's S-Lab License is explicitly non-commercial, so it is a clear problem for commercial use. On the EU side, Article 50 obligations have applied since 2 Aug 2026; machine-readable marking for systems already on the market is deferred to 2 Dec 2026. Restoration and colorization fall into a grey zone between the "assistive standard editing" exemption and "substantially alters" content.

### Cited Findings
**Model and dataset licences**
- GFPGAN code is Apache-2.0. A third-party ONNX conversion warns that the original code and weights "incorporate several third-party components under their own independent licenses", some possibly limiting commercial use. GFPGAN's training also uses a StyleGAN2 FFHQ prior (`StyleGAN2_512_Cmul1_FFHQ_B12G4_scratch_800k.pth`). — [TencentARC/GFPGAN repo](https://github.com/tencentarc/gfpgan); [HowToSD GFPGAN-ONNX model card](https://huggingface.co/HowToSD/GFPGAN-ONNX/blob/main/README.md)
- CodeFormer, S-Lab License 1.0: "Redistribution and use for non-commercial purpose in source and binary forms, with or without modification, are permitted". Commercial redistribution or use requires contacting the contributors. Binary redistributions must reproduce the copyright notice. — [CodeFormer LICENSE](https://github.com/sczhou/CodeFormer/blob/master/LICENSE)
- DDColor (colorization) code and weights are declared Apache-2.0. — [piddnad/DDColor](https://github.com/piddnad/ddcolor); [DDColor-models HF card](https://huggingface.co/piddnad/DDColor-models/blob/main/README.md?code=true). A third-party repackager notes the checkpoint was trained on ImageNet with ImageNet-22K initialisation lineage, and that ImageNet's access agreement limits dataset use to non-commercial research and education. The repackager excludes the "Artistic" checkpoint because it used undisclosed private data. — [LibreYOLO LibreDDColor card](https://huggingface.co/LibreYOLO/LibreDDColorl-restore)
- DeOldify weights are listed as MIT on an HF mirror, which also links MyHeritage In Color as the commercial version. — [HF DeOldify mirror](https://huggingface.co/thookham/DeOldify/blob/main/README.md)
- FFHQ: per-image licences are recorded separately, the dataset metadata is CC BY-NC-SA 4.0, and the page invites business inquiries about technology developed using FFHQ. — [savant-ai summary of dataset terms](https://savant-ai.io/blog/yolo-commercial-licensing/); [Adam Harvey, Creative Commons and the Face Recognition Problem](https://adam.harvey.studio/creative-commons/)
- Practitioner view: "dataset licence terms increasingly assert rights over models trained on the dataset — a question that remains unsettled in most jurisdictions". — [WCR.LEGAL, fine-tuned model licence](https://wcr.legal/fine-tuned-model-license/)
- Practitioner view: weights inherit the licence the distributor attaches. YOLO-NAS is the example (Apache code, non-commercial weights). ImageNet grants access only for non-commercial research. — [Savant AI, YOLO commercial licensing](https://savant-ai.io/blog/yolo-commercial-licensing/)
- A long-standing open GitHub issue asks whether Keras's MIT-licensed ImageNet weights conflict with the ImageNet terms, with no definitive answer. — [keras-team/keras #13362](https://github.com/keras-team/keras/issues/13362)
- Competition organisers treat this as a real compliance question too. — [DrivenData forum on ImageNet pretrained weights](https://community.drivendata.org/t/clarification-on-imagenet-pre-trained-weights-under-open-source-commercial-rules/11475)
- One source asserts that EU law makes models trained on non-commercial data "inherit those restrictions" when used commercially, but cites no provision. Treat this as **unreliable**. — [whales-identification LICENSE_MODELS.md](https://github.com/0x0000dead/whales-identification/blob/main/LICENSE_MODELS.md)

**EU AI Act Article 50**
- Article 50 obligations broadly apply from 2 Aug 2026. — [Paul Weiss memo](https://www.paulweiss.com/insights/client-memos/eu-finalises-transparency-rules-for-ai-generated-content)
- Art. 50(2): providers of systems that generate synthetic image, audio, video or text must mark outputs in a machine-readable form that is detectable as AI-generated or manipulated. The marking must be effective, interoperable, robust and reliable. Excluded: systems performing "an assistive function for standard editing" or that "do not substantially alter the input data". Other examples outside scope: format conversion and minor cropping. — [Paul Weiss](https://www.paulweiss.com/insights/client-memos/eu-finalises-transparency-rules-for-ai-generated-content)
- Grace periods: 50(2) marking and detection is deferred to **2 Dec 2026** for generative systems already on the market before 2 Aug 2026, and watermark-detection interoperability to **2 Feb 2027**. — [Paul Weiss](https://www.paulweiss.com/insights/client-memos/eu-finalises-transparency-rules-for-ai-generated-content)
- The Digital Omnibus (reported as Regulation (EU) 2026/1744) postponed the high-risk deadlines but not Article 50. Deepfake labelling under 50(4) has no grace period. — [Certivo](https://www.certivo.com/blog-details/eu-ai-act-august-2026-what-applies-after-the-digital-omnibus); [Black Matter VC](https://blackmatter.vc/lab/eu-ai-act-august-2026-what-changed-vs-what-got-delayed) (secondary sources; they disagree on whether the Omnibus was adopted in June or July 2026)
- The Commission's final Article 50 Guidelines were published on 20 July 2026. About 190 organisations had signed the Code of Practice by 31 July. Sources report the final Code of Practice on transparency of AI-generated content was published on 10 June 2026. — [Paul Weiss](https://www.paulweiss.com/insights/client-memos/eu-finalises-transparency-rules-for-ai-generated-content); [aiacto.eu](https://www.aiacto.eu/en/blog/article-50-ai-act-transparence-deepfakes-contenu-ia)
- 50(4) deepfakes: deployers must disclose. The test is objective, so neither intent nor photorealism is decisive; what counts is whether the subject is plausibly real. Disclosure for artistic works is lighter. The provider's machine-readable mark does not discharge the deployer's duty. Fines go up to the greater of EUR 15M or 3% of worldwide turnover. — [Paul Weiss](https://www.paulweiss.com/insights/client-memos/eu-finalises-transparency-rules-for-ai-generated-content)
- Commentators note that "substantially" is undefined. Some read standard editing broadly (colour correction, noise reduction, sharpening, minor retouching); others are more cautious once content is redrawn. — [Search Engine Journal, four exemptions](https://searchenginejournal.com/eu-commission-article-50-ai-transparency-law-has-four-exemptions/584528); [photoworkout](https://www.photoworkout.com/?p=223047); [Wolters Kluwer copyright blog](https://legalblogs.wolterskluwer.com/copyright-blog/can-copyright-law-benefit-from-the-marking-requirement-of-the-ai-act/)

### Inferences
- **Licence triage for SecurePhotos:**
  - *Avoid bundling* CodeFormer, which is explicitly non-commercial. Even a free app risks breaching it if the app is ever monetised or bundled, and "non-commercial" is ambiguous for publicly distributed software.
  - *Lower but non-zero risk:* GFPGAN (Apache code, FFHQ-trained prior and weights), DDColor and DeOldify (Apache/MIT, ImageNet lineage).
  - *Lowest risk:* models trained on permissively licensed or synthetic data, or models whose authors expressly grant commercial weight use.
- Practical mitigations for an individual developer: keep a `MODEL_LICENSES` / third-party notice file listing each model's licence, source URL, training dataset and SHA-256. Reproduce copyright notices, which S-Lab and Apache require. Do not use model authors' names in marketing (the S-Lab endorsement clause). Prefer making models **optional user-initiated downloads from the upstream source** over bundling them in the installer. That arguably moves redistribution to upstream, though this has not been tested legally. Get a lawyer's view before any paid tier.
- The Article 50(2) duties fall on the *provider* of the generative system. An individual distributing a free tool in the EU may count as a provider. Face reconstruction and B&W colorization plausibly "substantially alter" content, so the safe approach is to embed machine-readable marking (IPTC DigitalSourceType, optionally C2PA) on every exported restored or colorized image. Deepfake disclosure under 50(4) mainly falls on the *deployer* (the user publishing the image), but in-app labels make that easy. The EU AI Act excludes purely personal non-professional use for deployers (Art. 2(10)); this was not verified against the text in this pass.
- Whether the open-source exemption (Art. 2(12)) covers Article 50 is doubtful, because it carves Article 50 out. This is unverified here and should be checked against the regulation text.

### Gaps
- I did not fetch the primary Article 50 / Art. 2 text from EUR-Lex. The open-source and personal-use exclusions are unverified.
- I found no court ruling on whether weights are derivative works of their training data.
- No primary source confirmed the official FFHQ or ImageNet terms, because the dataset pages were not fetched (FFHQ: github.com/NVlabs/ffhq-dataset; ImageNet: image-net.org/download).
- Real-ESRGAN's licence (reportedly BSD-3-Clause) was not verified in this pass.
- I found no lawyer analysis specific to free, MIT-licensed desktop apps that bundle such weights.

## CPU-only deployment (owner constraint: no dedicated GPU) and UX for slow processing

### Takeaway
Design for ONNX Runtime **CPU EP as the primary path** and treat GPU as a bonus. Key levers:
- leave intra-op threads at the default (one per physical core), or cap them at cores−1 so the UI stays responsive;
- turn thread spinning off to save power and battery;
- use sequential execution;
- use int8 static QDQ quantization only where accuracy holds and the CPU has VNNI. It can be *slower* on older CPUs;
- **do not use fp16 on CPU**, because the CPU build lacks fp16 ops;
- tile large images to bound memory;
- run jobs in a low-priority / EcoQoS background worker, with a queue, progress, cancel and a low-resolution preview first.

### Cited Findings
- **Threads:** with `intra_op_num_threads` = 0 (default), ORT creates one thread per *physical* core, not per logical processor. Setting an explicit count disables the default thread affinity. Execution mode defaults to `ORT_SEQUENTIAL`; parallel mode helps only branchy models and can hurt others. — [ORT threading docs](https://onnxruntime.ai/docs/performance/tune-performance/threading.html)
- **Spinning:** on by default. It speeds inference but "uses more CPU cycles, resources, and power". Disable it with `session.intra_op.allow_spinning = "0"` (and the inter_op equivalent). The docs say `spin_backoff_max` reduces CPU and power use on hybrid and mobile platforms. — [ORT threading docs](https://onnxruntime.ai/docs/performance/tune-performance/threading.html)
- **Affinity:** it is "normally best to not set thread affinity and let the OS handle thread assignment" for performance and power reasons. — [ORT threading docs](https://onnxruntime.ai/docs/performance/tune-performance/threading.html)
- **Quantization:**
  - Static quantization is recommended for CNNs; dynamic suits RNNs and transformers.
  - "S8S8 with QDQ is the default setting and balances performance and accuracy"; "S8S8 with QOperator will be slow on x86-64 CPUs and should be avoided".
  - "Old hardware has none or few of the instructions needed to perform efficient inference in int8"; "it is not rare to get worse performance on old devices". x86-64 with VNNI benefits.
  - Quantization "may negatively affect a model's accuracy". Per-channel quantization helps when weight ranges are large, and reduce-range / U8U8 helps on non-VNNI AVX2/AVX512 machines that saturate. — [ORT quantization docs](https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html)
- **fp16:** conversion can "improve performance on some GPUs", but "the CPU version of ONNX Runtime doesn't support float16 ops". — [ORT float16 docs](https://onnxruntime.ai/docs/performance/model-optimizations/float16.html)
- **Memory:** sharing an arena allocator between sessions reduces memory use across multiple sessions. On Windows, ORT can be built with mimalloc (`--use_mimalloc`). — [ORT memory docs](https://onnxruntime.ai/docs/performance/tune-performance/memory.html)
- **CPU speed reference points (indirect):** Qualcomm's w8a8 ONNX Real-ESRGAN-General-x4v3 runs at about 115–153 ms per call on Snapdragon *CPU*, versus a few ms on the NPU. Its profiling uses 128×128 inputs, so those are per-tile figures. These are Arm chips, not x86 laptops. — [Qualcomm Real-ESRGAN-General-x4v3](https://huggingface.co/qualcomm/Real-ESRGAN-General-x4v3); [Qualcomm Real-ESRGAN-x4plus](https://huggingface.co/qualcomm/Real-ESRGAN-x4plus)
- The Real-ESRGAN FAQ says the ncnn build is faster than PyTorch for CPU inference, and that the PyTorch path needs fp32 on CPU. — [Real-ESRGAN FAQ (mintlify mirror)](https://mintlify.com/xinntao/Real-ESRGAN/resources/faq)
- **Windows power / background QoS:** `SetProcessInformation` with `ProcessPowerThrottling` and `PROCESS_POWER_THROTTLING_EXECUTION_SPEED` tags a process as EcoQoS. Microsoft says EcoQoS shouldn't be used for performance-critical or foreground work. Before Windows 11 the level was LowQoS. — [Microsoft Learn, Quality of Service](https://github.com/MicrosoftDocs/win32/blob/docs/desktop-src/ProcThread/quality-of-service.md); [Microsoft DevBlogs, EcoQoS (2021)](https://devblogs.microsoft.com/performance-diagnostics/?p=314)
- Common practice pairs `IDLE_PRIORITY_CLASS` with EcoQoS. A lower priority alone does not trigger Task Manager's "Efficiency mode". Check the API's return value, because a failure is otherwise silent. — [compactrs power.rs](https://docs.rs/crate/compactrs/latest/source/src/engine/power.rs); [Microsoft Q&A, Python efficiency mode](https://learn.microsoft.com/en-us/answers/questions/2155580/how-do-i-force-a-python-script-to-run-in-efficienc); [WinUIEx PR](https://gh.r-mj.com/dotMorten/WinUIEx/pull/252/files)
- **UX precedents for slow, one-shot processing:** Lightroom Enhance runs as an explicit per-photo action, writes a new file and cannot be re-applied. — [Adobe Help](https://helpx.adobe.com/lightroom-cc/using/enhance-details.html). Topaz applies Recover Faces only when Autopilot is on and otherwise waits for the user to add it. — [Topaz docs](https://docs.topazlabs.com/photo-ai/enhancements/recover-faces)

### Inferences
- **Session config for the Python engine:** `providers=["CPUExecutionProvider"]` (try DML first only if a DX12 GPU is detected and a smoke test passes); `sess_options.intra_op_num_threads = max(1, physical_cores - 1)` when the user is active, full cores when they choose "Fast"; `execution_mode = ORT_SEQUENTIAL`; `add_session_config_entry("session.intra_op.allow_spinning", "0")`; `graph_optimization_level = ORT_ENABLE_ALL`, with the optimised model cached to disk (`optimized_model_filepath`) so later runs start faster. Load one model at a time and free sessions after a job, since several 300+ MB fp32 models resident at once will strain 8 GB machines.
- **Model choice for CPU:**
  - prefer compact architectures (Real-ESRGAN "General x4v3" / SRVGG compact over RRDB x4plus; DDColor tiny over large; GFPGAN v1.4 at 512 px face crops);
  - restore faces on detected 512×512 crops only and paste them back, rather than running the whole image through a heavy network;
  - default the upscale to 2× and offer 4× as an option;
  - ship fp32 ONNX as the reference and offer int8 QDQ (per-channel, calibrated on a few dozen old photos) only for models that pass a visual and PSNR/SSIM check;
  - pick int8 vs fp32 at runtime from a CPU feature check (AVX512-VNNI / AVX-VNNI present → int8), or with a one-time micro-benchmark on first use.
- **Tiling:** process at fixed tile sizes (for example 128–256 px for SR, with 16–32 px overlap and feathered blending). This bounds peak RAM, keeps tensor shapes static (which helps ORT memory planning), and gives natural progress ticks (tiles done / total) plus cancellation between tiles. Cap the input megapixels, offering to downscale above about 12 MP before restoration, since scans are often huge.
- **Background worker:** run inference in a separate Python process, not a thread, so cancel can terminate it hard and it can be put into EcoQoS / below-normal priority. Pause or slow down on battery: Windows reports battery state via `GetSystemPowerStatus`, and Tauri has power plugins. That API detail was not researched here, so verify it. Show "Plugged in recommended" for batches.
- **UX for slow CPU:**
  - (1) strictly on demand, per photo or explicit multi-select, never automatic over the library;
  - (2) **instant preview**: run on a downscaled copy (for example 512 px long edge) or on a single face crop first, and show it in the compare slider within seconds; the user then commits to the full-resolution render;
  - (3) a **queue panel** with per-item progress, cancel, reorder, and "run when idle / plugged in";
  - (4) an **ETA** from a calibration run (ms per tile measured on first use × tile count), updated live;
  - (5) a notification when done; the result is saved as a new version so the user can keep browsing;
  - (6) separate toggles for repair (scratches), faces, colorize and upscale, so users don't pay for steps they don't need.
- GPU (DirectML / Windows ML) becomes an automatic accelerator. It is detected and used if available, but no feature depends on it.

### Gaps
- I found no x86 laptop CPU benchmarks (for example Intel Core i5/i7 U-series, Ryzen 5) for GFPGAN, CodeFormer, DDColor or Real-ESRGAN in ONNX Runtime. The owner must benchmark locally; the Qualcomm Arm CPU numbers are only indicative.
- I did not verify int8 quantization quality for GAN restoration and colorization models. GAN generators are often sensitive to quantization, so test each model.
- Tauri / Windows battery-state API details were not researched.

## Windows deployment: DirectML status, Windows ML, CPU fallback, model size and download strategy, hash verification (GPU is now an optional bonus)

### Takeaway
DirectML is now "sustained engineering" (Microsoft Learn) or "maintenance mode" (the GitHub banner). It still works and ships with Windows, but new work has moved to **Windows ML**. Windows ML bundles CPU plus DirectML (marked "legacy") and downloads vendor execution providers (OpenVINO, QNN, NvTensorRtRtx, AMD GPU, VitisAI, experimental WebGPU) on demand on Windows 11 24H2+. For a Python engine, `onnxruntime-directml` remains the practical cross-vendor GPU path today. Hold to its constraints (opset ≤20, sequential execution, one Run per session at a time) and keep a CPU fallback.

### Cited Findings
- The DirectML GitHub repo carries the banner "DirectML is in maintenance mode" and suggests Windows ML on Windows 11 24H2 (build 26100)+. DirectML stays supported on earlier releases and keeps shipping with Windows. — [microsoft/DirectML](https://github.com/microsoft/DirectML)
- ONNX Runtime DirectML EP page: "DirectML is in sustained engineering"; new feature work has moved to WinML. Requirements: a DirectX 12 device (NVIDIA Kepler+, AMD GCN1+, Intel Haswell+, Qualcomm Adreno 600+) and Windows 10 1903+. Constraints: memory pattern disabled, execution mode `ORT_SEQUENTIAL`, and only one thread calling Run per session (different sessions can run on different threads). Supports up to ONNX opset 20 (ONNX 1.15), except GridSample-20 5D and DeformConv; models needing a higher opset "are unsupported and will perform poorly". — [ONNX Runtime DirectML EP docs](https://onnxruntime.ai/docs/execution-providers/DirectML-ExecutionProvider.html)
- The ONNX Runtime Windows page says DirectML is embedded in `Microsoft.Windows.AI.MachineLearning.dll` and exposed via WinRT under Windows ML. — [ONNX Runtime, Get started with Windows](https://onnxruntime.ai/docs/get-started/with-windows.html)
- Windows ML EPs (page updated 2026-11-13):
  - *Included:* CPU and DirectML (legacy).
  - *Downloaded on demand* via `ExecutionProviderCatalog` on Windows 11 24H2+. Windows ML 2.x: AMDGPUExecutionProvider (min package 2.5.96, Adrenalin 24.12.1+), NvTensorRtRtx (RTX 30xx+), OpenVINO (Intel), QNN (Snapdragon X), VitisAI (AMD NPU), WebGPU (experimental; any DX12 GPU), MIGraphX (deprecated in favour of AMDGPU EP).
  - Windows ML 1.8.x has the earlier set.
  - Each EP comes with its own licence terms. — [Microsoft Learn, Windows ML execution providers](https://learn.microsoft.com/en-us/windows/ai/new-windows-ml/supported-execution-providers)
- EP release history: — [microsoft/WindowsML wiki, EP releases](https://github.com/microsoft/WindowsML/wiki/Windows-ML-Execution-Provider-Releases)

### Inferences
- **Recommended engine strategy:** keep `onnxruntime-directml` (Python) as the GPU path on Windows 10/11 for 2026–27, with CPUExecutionProvider as the fallback. Pin the ORT version. Export models at opset ≤ 20 and avoid DeformConv: several restoration architectures use deformable convolutions, so test each candidate model on DML. Use one session per model, serialise Run calls, and run long jobs in a worker with progress and cancel.
- Track Windows ML: the vendor EPs it downloads (OpenVINO, TensorRT-RTX, QNN for Snapdragon NPUs) give large speedups, but they need the Windows App SDK / WinRT and Windows 11 24H2+. That fits a future Rust or C# host better than the current Python engine. Note the experimental WebGPU EP as a possible long-term cross-vendor replacement for DML.
- **Hardware tiers:** detect the DX12 adapter and VRAM at start-up. Offer tile-based processing (for example 256–512 px tiles with overlap) so upscalers fit 2–4 GB VRAM and stay workable on CPU. Warn before CPU runs on large images.
- **Model packaging:** install a small core and offer optional models, downloaded on first use from a pinned URL, with a SHA-256 check before the file is loaded. Store the files in the app data folder (possibly inside the encrypted vault area). Record the hashes in a signed manifest shipped with the app, so that downloads, even from upstream (Hugging Face / GitHub releases), are verified against hashes the app already trusts. Downloading once can be squared with the "fully offline" promise: let users also import the model file manually, then everything runs offline. Offer an "offline bundle" installer for users who want everything up front.
- Typical sizes, from my background knowledge and not verified in this pass: GFPGAN v1.4 ≈ 330 MB fp32, CodeFormer ≈ 370 MB, Real-ESRGAN x4plus ≈ 64 MB, DDColor tiny/large ≈ 100–900 MB, DeOldify ≈ 120–250 MB. fp16 export roughly halves these. Bundling several would push an installer past 1 GB, which supports making models optional downloads.

### Gaps
- I found no published CPU vs DirectML benchmark numbers for GFPGAN, CodeFormer, Real-ESRGAN or DDColor on typical laptops. This needs local benchmarking.
- I could not confirm the latest `onnxruntime-directml` PyPI version or release cadence for 2026, or whether ORT plans to drop the DML EP from PyPI builds. The DML EP docs page still shows old version examples (ORT 1.14.1), which is outdated.
- I found no Microsoft guidance on using Windows ML EPs from Python. Windows ML is documented for the WinRT / Windows App SDK (C#/C++) path.
- Model file sizes above come from background knowledge and are not cited.
