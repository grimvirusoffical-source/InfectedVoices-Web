export const GUIDE_VERSION='studio-2026-09-collab-v2';
export const GUIDES=[
  {id:'welcome',title:'Your studio, your account',target:'brand',paragraphs:[
    'The portal is your home for news, downloads, setup guides, subscriptions and lifetime codes. The Studio is where your music is made. Google sign-in identifies the account; a subscription or an email-bound lifetime code unlocks the studio. A code must be redeemed with the Google email it was issued to.',
    'This walkthrough is required once for this studio version, including for existing members. Progress is saved to your account. Later, Tutorial lets you repeat the full tour or choose a topic. A desktop installation can offer its own optional recap after you complete this web tour.',
    'There is no need to record anything or make a purchase during this tour. Keep your original recordings backed up. The classic studio remains available for old workflows while this new arrangement workspace is in preview.'
  ]},
  {id:'projects',title:'Projects and safe saving',target:'projectBar',paragraphs:[
    'A project contains track settings and clips that point to immutable audio assets. Moving, trimming, splitting or duplicating a clip does not overwrite its source recording. Undo and Redo change arrangement edits; they do not undo a cloud purchase or an external upload.',
    'Save on device stores a project under this account in this browser. Open saved lets you manage multiple projects. Browser storage can be cleared, so use Download project for a portable .ivproject backup with the audio included. Never depend on a browser save as your only copy.',
    'Import classic project accepts supported .ivweb backups from the previous browser studio. Proprietary native desktop projects are not automatically converted. Export audio stems from those projects and bring the WAV files into this workspace.'
  ]},
  {id:'prepare',title:'1 · Prepare the song and microphone',target:'transport',paragraphs:[
    'Import your beat onto a Beat track. Additional beats, ambience and sound effects can each have their own tracks or share existing tracks. Set the project tempo to the beat BPM and choose its musical root and scale. The default 150 BPM / G minor is a starting point, not an analysis of your file.',
    'The grid marks musical time. Grid start accounts for silence before the first beat. Snap controls where moved clips land; turn it off for free placement. Choose one-bar or several-bar loop boundaries to practice a section. Place the playhead where the verse should start.',
    'Use headphones, select a vocal track, enable the microphone and watch the input meter. Lower the physical input gain when the mic clips; lowering the track fader later cannot reconstruct a clipped recording. Bluetooth and software monitoring can add delay. Make a short test before a full take.'
  ]},
  {id:'record',title:'2 · Record onto the timeline',target:'record',paragraphs:[
    'Select the Vocal track you want to record onto, then press Record. A count-in gives you time to enter. The existing arrangement plays in your headphones while the microphone records dry audio. The app does not digitally add its metronome or backing track to the recorded microphone signal.',
    'Stop finalizes the take and places it at the chosen song position. Loop recording produces separate takes for each pass. The first take is audible; later takes start muted to avoid stacking several performances accidentally. Select a take and change its mute state to audition it.',
    'Recording compensation moves a finished take earlier or later to correct a measured device delay. Positive values move it earlier. Do not guess a large number. Dry mic monitoring is optional and can feed back through speakers. Engine and edit changes are blocked during capture; stop first so the original recording stays safe.'
  ]},
  {id:'arrange',title:'3 · Choose takes and arrange clips',target:'timeline',paragraphs:[
    'Drag a clip left or right to change when it plays and vertically to move it between tracks. Hold Shift while dragging to ignore snap. Drag the clip edge handles to trim the audible region. The inspector also provides numeric start, source offset, length and fade controls for precise or touch-friendly editing.',
    'Place the playhead inside a selected clip and Split to divide it. Duplicate places a copy after the selected clip. Each copy references the same source audio; deleting a clip does not erase the source from your saved project while it is still referenced. Undo can recover a deleted clip during the current session.',
    'Use short fades to soften edit boundaries. Mute silences a track or clip. Solo lets selected tracks play by themselves; multiple solo tracks can play together. Pan positions audio across the stereo field. Track gain affects all its clips, while clip gain adjusts just the selected region.'
  ]},
  {id:'timing',title:'4 · Align timing without erasing your flow',target:'inspector',paragraphs:[
    'Choose a vocal clip and a timing preset that matches the performance: natural rap, tighter trap, triplets or singing. Check BPM, grid start and note division before correcting. An incorrect grid can make a good performance worse.',
    'Preview alignment creates a proposed dry-audio correction. Listen before choosing Keep alignment. The original asset is retained and Undo restores the prior arrangement. A zero-strength correction leaves every sample unchanged. New edits invalidate an old preview.',
    'Legacy timing detects onsets; Infected timing moves separated activity regions into nearby silence. Both avoid overwriting neighboring words. Core 4 also adds explicit warp anchors for selected vocal clips. Warp anchors use waveform-similarity overlap/add to move internal timing while keeping the clip’s overall duration. Automatic timing still is not a lyric-understanding system; audition every change.'
  ]},
  {id:'tuning',title:'5 · Choose pitch and vocal character',target:'engines',paragraphs:[
    'Set the song key first, then pick a vocal preset. Correction amount blends the pitch toward allowed scale notes; retune time controls how quickly the target is followed. Slower correction usually keeps more pitch movement, while a fast full correction is deliberately synthetic.',
    'The tuning and sound engine switches are independent. Legacy retains the earlier pitch approach; Infected uses a separate confidence-gated, four-grain pitch path. The sound switch chooses the tone/dynamics processing. The same clips and settings remain in your project when you switch.',
    'Transpose changes pitch by semitones and the lower-octave layer adds weight. Extreme GRIM or Abyss presets can reduce intelligibility. For untuned rap, set correction to zero; transpose and octave layers can also be set to zero. Core 4 Precision Tune adds visible pitch analysis and pitch-synchronous overlap/add for manual note targets, designed to retain the original grain spectrum more faithfully than playback-rate shifting. It is local DSP, not neural voice conversion; audition difficult voices and extreme shifts.'
  ]},
  {id:'mix',title:'6 · Mix the tracks together',target:'inspector',paragraphs:[
    'Mixing balances individual parts. Start with the beat, bring the main vocal up until the words remain clear, then add doubles, harmonies and effects at lower levels. Listen to the full song rather than only a solo vocal. Gain, pan and mute are useful before adding more processing.',
    'High-pass filtering reduces low rumble, body shapes low warmth, presence changes articulation, and compression reduces level differences. De-essing in the Infected path reduces excessive high-frequency sibilance. Too much of any setting can make a voice thin, dull or flat.',
    'Echo and reverb create space. Start small on fast lyrics. Analyze balance offers a measurable starting point, not a finished artistic decision. Advanced controls remain available behind expandable panels. Click an information button for each setting’s units, effect and cautions.'
  ]},
  {id:'master',title:'7 · Master and compare the final mix',target:'inspector',paragraphs:[
    'Mastering processes the combined stereo mix after track balance is right. Choose a conservative preset first. Compare the preview with the unmastered mix at similar listening loudness so a louder file is not automatically judged better.',
    'Target level here is an RMS proxy, not a standards-certified LUFS measurement. Ceiling controls sample-peak headroom; it does not certify intersample true peaks. The Infected master uses stereo-linked lookahead limiting. The Legacy option uses the retained simpler peak-bounded approach in this workspace.',
    'Keep dynamics when that serves the song. Excessive compression, drive or width can smear transients or create unpleasant distortion. Render, listen on headphones and speakers, and keep a clean pre-master export. Neither the local nor cloud engine can guarantee commercial quality for every recording.'
  ]},
  {id:'export',title:'8 · Export a mix or aligned stems',target:'inspector',paragraphs:[
    'Export WAV creates real PCM audio. Choose 24-bit for a production handoff or 16-bit when required by the destination. A higher export bit depth does not repair a low-quality recording. MP3 remains available in the classic studio.',
    'Export aligned stems creates one WAV per track with leading silence so every file lines up when imported at time zero in another DAW. A session metadata file records tempo and key. Dry stems omit vocal processing; processed stems include the selected vocal engines and track effects.',
    'Keep the .ivproject backup as well as exported audio. Distribution services can require their own artwork, metadata, rights declarations and audio specifications. Exporting a file is not the same as submitting a release or linking an external account.'
  ]},
  {id:'ai',title:'AI tools, tiers, consent and credits',target:'aiTab',paragraphs:[
    'Local recording and DSP do not upload your audio. The AI coach uses written project settings unless a tool explicitly asks for an audio upload. AI-assisted parameter plans are suggestions that must be previewed before applying; a text response is not proof that the system heard your track.',
    'RoEx cloud mixing or stem separation requires an approved API account and explicit upload consent. Provider credits are separate from any Infected Voices wallet. A failed request must show an error, not a fake completed master or a fabricated credit balance.',
    'Premium tier prices and the Infected Voices currency catalog must be configured and verified before new purchases are enabled. Existing subscriptions and lifetime access stay intact. Stem separation belongs to the highest tier; provider configuration and server authorization still apply. Removing a vocal is a separation task, not phase cancellation marketed as AI.'
  ]},
  {id:'plugins',title:'Plugins and safe extension packages',target:'pluginsTab',paragraphs:[
    'The plugin library starts with installable preset packages. Install adds a package to your library; Apply changes the selected vocal track’s settings and can be undone. Removing an installed package does not silently change a track that already uses its settings.',
    'Developer packages declare an API version, identity, author, version and validated settings. Imported packages are data, not arbitrary JavaScript. They cannot request account tokens, execute a computer command or silently upload your recordings.',
    'This first extension format supports presets. Arbitrary native VST, AU, CLAP or executable third-party modules are not hosted by the browser. Those require a separate sandboxed host and release review. The developer guide distinguishes implemented capabilities from future extension points.'
  ]},
  {id:'integrations',title:'FL Studio, Rap Fame and distribution',target:'integrationsTab',paragraphs:[
    'FL Studio handoff uses aligned WAV stems and, where available, the separately supplied CLAP effect. Import every aligned WAV at song time zero and set the same BPM. A plugin or file handoff is not an FL Studio cloud-account connection.',
    'Rap Fame is currently a manual audio handoff because a supported public account/upload API has not been verified for this app. Do not enter a Rap Fame password here. A saved profile link is not a verified account connection.',
    'Distribution integrations depend on approved partner APIs and credentials. The release package helps assemble artist/title/rights metadata and audio for manual submission. Direct delivery, royalties and DSP status must remain unavailable until a real authorized provider adapter is configured. No app should invent a successful release submission.'
  ]},
  {id:'desktop',title:'Desktop, updates and finding help again',target:'tutorial',paragraphs:[
    'The desktop build is designed for a dedicated window, native file dialogs and a denser arrangement layout. Google authentication can open a system browser for sign-in without turning the studio itself into a browser tab. Windows and macOS packages need separate build, signing and real-device checks.',
    'Check for updates only when you are not recording. A verified updater should download a signed release, keep your project data separate and ask before restarting. If no release feed is configured, it must say so instead of pretending an update succeeded.',
    'Use Tutorial for a full recap or a specific topic. Use the wrench to choose automatic, iOS, Android or PC layout. Save a portable project before moving devices or hosts. You are ready to start with a beat, set tempo/key, make a short test recording, and build from there.'
  ]}
];
export const HELP={
  title:['Project title','Names the current arrangement, project backups and audio exports. Renaming does not overwrite a different project or move audio. Save on device updates this project’s ID; download a backup for a portable copy.'],
  trackName:['Track name','Labels one arrangement lane and its exported stem. Examples: Main beat, Lead vocal, Ad-lib left, Impact. Renaming never changes the source recording.'],
  clipName:['Clip name','Labels this region only. Several regions can share the same source recording but have different names, positions and trims. A clip is an edit instruction, not another destructive copy.'],
  kind:['Track / audio type','Vocal tracks pass through the selected pitch and vocal sound engines. Beat and effect tracks retain their original pitch and stereo audio. All types support arrangement edits, gain, pan and export. Use Vocal only when monophonic vocal processing is intended.'],
  inputDevice:['Microphone input','Select the physical microphone or interface input exposed by your operating system. Permission is requested before device names are available. Changing the selection releases the previous microphone. Windows ASIO routing is not provided by this browser audio path.'],
  importSeparate:['One track per file','On creates a separate arrangement lane for each imported audio file. Off puts every chosen file on the selected lane at the current playhead, so overlapping files will play together. Move clips afterward to build verses, choruses and effects.'],
  timingPreset:['Timing preset','Natural rap uses restrained sixteenth-note moves; Tight trap increases strength with a little swing; Triplet flow uses eighth-note triplets; Singing makes smaller moves on an eighth-note grid. Choose according to the performance, then preview before keeping.'],
  releaseTitle:['Release title','The public song or release name placed in a local metadata draft. The draft is not uploaded to a distributor. Check spelling, version labels and the destination’s metadata requirements before submission.'],
  artist:['Primary artist','The public recording-artist name in the release draft. This field does not verify identity, resolve an existing artist page or link a distributor account. Confirm artist-page mapping with your distributor.'],
  isrc:['Existing ISRC','Optional existing recording identifier. Enter it only when it belongs to this exact recording. Leaving it blank does not allocate a new code; allocation and duplicate-release rules are handled by your authorized distributor.'],
  releaseDate:['Requested release date','An ISO calendar date (YYYY-MM-DD) included in the local draft. This does not reserve a store release slot or guarantee delivery time. Confirm scheduling requirements with the distribution provider.'],
  explicit:['Explicit-content flag','Records your declaration about explicit content in the release metadata draft. It does not inspect or censor the audio. Review lyrics and each destination’s requirements before distribution.'],
  rights:['Audio rights confirmation','Confirms you hold the permissions needed for the intended processing or release. Importing a beat or separating a vocal does not grant a license. No account is linked and no copyright clearance is performed by this checkbox.'],
  aiTask:['AI parameter task','Chooses which bounded controls the parameter assistant may suggest: tuning, timing, vocal mix or stereo mastering. It receives numeric levels and your written goal, not audio. You review the plan before applying it to the project.'],
  goal:['Production goal','Describe the sound or balance change you want in up to 600 characters. This text and numeric measurements are sent to the assistant. Do not include passwords or private account credentials. The assistant cannot hear the selected clip through this feature.'],
  separationMode:['Stem separation mode','Vocals + instrumental produces a vocal stem and a no-vocals backing. Four-stem mode requests vocals, drums, bass and other. This uses the external provider after explicit consent and can contain separation artifacts; it does not recover original studio multitracks exactly.'],
  cloudStyle:['Cloud music style','Selects the provider’s automatic mix recipe. Choose the closest overall genre. It influences the result but does not expose full per-track EQ, pan or dynamics control; use local track controls before uploading.'],
  cloudLoudness:['Cloud loudness preset','LOW aims for more dynamics, MEDIUM is a balanced starting point and HIGH is louder. These are provider presets, not guarantees of an exact LUFS result. Listen to the free preview before confirming the final provider-credit charge.'],
  deviceMode:['Device layout','Auto detects a touch-oriented iOS/Android layout or desktop spacing. A forced mode changes control sizes and arrangement spacing, not hardware, operating system, microphone latency or audio-driver support.'],
  tutorial:['Tutorial and recap','Eligible accounts complete the current 14-chapter first-use walkthrough once per tutorial version. Progress belongs to the signed-in account. After completion, Tutorial offers the entire walkthrough or one topic. Desktop can offer an optional recap after the web tutorial is complete.'],
  bpm:['Tempo / BPM','Beats per minute defines the musical grid and metronome. Match the beat’s actual tempo; changing BPM does not stretch imported audio. Default: 150. Range: 30–300.'],
  root:['Root note','The tonal center used by pitch correction. Select the key of the song, not the note you happen to be singing. G is only the initial default. Wrong keys can create unwanted pitch movement.'],
  scale:['Scale','The notes pitch correction is allowed to target. Minor and major use different note sets; chromatic allows all 12 notes and minor pentatonic uses five. Check the beat by ear.'],
  gridOffset:['Grid start / seconds','The time of the first musical grid beat. Use this when a file has leading silence or a pickup. It changes alignment targets and snap placement, not the source audio.'],
  cursor:['Playhead / seconds','Where normal playback or recording starts. Click the ruler or enter a precise time. With looping enabled, playback starts at the loop’s A point.'],
  snap:['Snap division','Constrains dragged clip starts to quarter, eighth, sixteenth or triplet grid positions. Off permits free timing. Hold Shift during a drag to bypass snap temporarily.'],
  zoom:['Timeline zoom','Pixels per second. A higher value shows edit boundaries more clearly; a lower value fits more of the song. Zoom never changes timing or sound.'],
  loop:['Loop recording','Repeats A–B and records each pass as a separate take. New extra takes start muted so they do not all play at once. Use clip mute to compare takes.'],
  loopStart:['Loop A / seconds','Start of the repeated region. Must be earlier than Loop B. During looping this also becomes the recording insertion point.'],
  loopEnd:['Loop B / seconds','End of the repeated region. The interval from A to B is one pass. Choose a musical boundary to avoid an awkward loop restart.'],
  countIn:['Count-in / bars','Number of four-beat bars before recording begins. The count-in is heard only in playback; it is not digitally mixed into the dry microphone recording. Range: 0–4.'],
  compensationMs:['Recording compensation / ms','Corrects a measured recording delay. Positive moves the completed take earlier; negative moves it later. Use a test recording before changing this; device and Bluetooth latency vary.'],
  metronome:['Metronome','An audible click to help timing. It is routed to headphones, not the digital dry capture. Speakers can still leak acoustically into the microphone.'],
  monitor:['Dry microphone monitoring','Lets you hear your unprocessed microphone through the app. Use headphones at a low volume; software and Bluetooth delay can be distracting. Classic Studio retains live processed monitoring.'],
  sound:['Sound engine','Legacy uses the earlier Web Audio tone/dynamics chain with its original shaping. Infected uses a separate local EQ, soft-knee compressor, sibilance control and bounded ambience path. Switch while stopped; audition before export.'],
  tuneEngine:['Tuning engine','Legacy uses the earlier two-grain pitch path. Infected uses confidence-gated fractional YIN estimation and four-grain cubic interpolation. These are monophonic local DSP paths, not neural/formant-preserving guarantees.'],
  timingEngine:['Timing engine','Legacy relocates detected syllable/onset regions into silence. Infected uses activity-island phrasing and silence-aware moves. Both preserve source audio and reject collisions. Preview and listen before keeping.'],
  masterEngine:['Master engine','Legacy uses the simpler peak-bounded master adaptation. Infected adds stereo-linked lookahead limiting. Neither label certifies professional quality, LUFS compliance or intersample true-peak safety.'],
  gainDb:['Gain / dB','Changes loudness without moving the clip. Track gain affects every clip on that track; clip gain affects only one region. Negative values lower level. Gain cannot repair input clipping.'],
  pan:['Pan','Places audio left (-1), center (0), or right (+1). The stereo panner follows the track. Check the full mix and mono compatibility when using wide placement.'],
  start:['Clip start / seconds','The time this region begins in the song. Moving it leaves the source samples untouched. Split at the playhead to edit only part of a region.'],
  offset:['Source offset / seconds','The position inside the original audio where this clip begins reading. Increasing this trims the beginning without deleting samples. Keep offset + length inside the source duration.'],
  duration:['Clip length / seconds','How much source audio the clip uses. Editing this trims or extends within the available source. It is not a time-stretch control.'],
  fadeIn:['Fade-in / seconds','Gradually raises the start of the clip from silence. A few milliseconds can soften a cut; longer fades are useful for pads and transitions. This is applied before vocal processing so effect tails remain natural.'],
  fadeOut:['Fade-out / seconds','Gradually lowers the clip body to silence near its end. Does not delete the source audio. Reverb and echo may continue after the clip body.'],
  tune:['Pitch correction / amount','0 leaves note correction off; 1 fully targets allowed scale notes. Retune time still controls the response speed. Transpose and lower-octave layers are independent and must also be zero for a fully unshifted pitch path.'],
  retune:['Retune speed / milliseconds','How quickly correction follows a detected target. Low values create a hard-tuned effect; higher values retain more slides. A slow retune can miss fast notes. Range: 1–250 ms.'],
  shift:['Transpose / semitones','Moves pitch up or down. -12 is one octave down and +12 one octave up. Extreme values can sound synthetic and do not guarantee formant preservation.'],
  sub:['Lower-octave blend','Adds a layer one octave below the shifted voice. Helpful for a darker character; too much can blur consonants and compete with bass. Start below 0.3.'],
  drive:['Saturation / drive','Adds nonlinear harmonic distortion. A little can add density; high values can sound gritty, reduce clarity or increase peaks. The master drive is separate from vocal drive.'],
  gate:['Noise gate / dB','Attenuates quiet input below a threshold. Less negative thresholds gate more aggressively. If word endings disappear, lower the threshold. A gate does not remove noise that overlaps speech.'],
  highpass:['High-pass filter / Hz','Reduces low-frequency rumble below the cutoff. Start around 70–100 Hz for a vocal and listen. Raising it too far removes body; it is not a stem separator.'],
  body:['Body EQ / dB','A low-shelf adjustment around 220 Hz. Positive adds warmth; negative reduces muddiness. Judge with the backing track rather than in isolation.'],
  presence:['Presence EQ / dB','A broad presence adjustment around 3.2 kHz. Positive can help articulation; excessive boosts can sound harsh. Negative values soften the voice.'],
  compression:['Compression threshold / dB','Above this threshold, dynamics are reduced according to the ratio. More negative thresholds compress more of the vocal. Avoid flattening every syllable.'],
  ratio:['Compression ratio','How strongly levels above the threshold are reduced. A 3:1 ratio is a moderate starting point. Larger ratios sound denser but can reduce expression.'],
  echo:['Echo blend','Level of delayed reflections. Delay sets the spacing. Use small amounts for fast rap to keep lyrics intelligible. This does not align the original vocal to the beat.'],
  delay:['Echo delay / seconds','Time between the original voice and echo. At 150 BPM, a quarter note is 0.4 s and an eighth note is 0.2 s. Match by ear or calculate 60/BPM for one beat.'],
  reverb:['Reverb blend','Adds short diffused reflections around the voice. Small values create space; larger values push the vocal back. Reverb tails are retained in the rendered clip.'],
  gain:['Vocal output / dB','Final output gain for the selected vocal processing chain, before track gain. Use it to compare presets at similar loudness. It is separate from microphone hardware gain.'],
  glitch:['Glitch pulse depth','Adds a repeating short amplitude dip to create a chopped character. Higher values are deliberate effects and may reduce intelligibility. This is not an automatic beat-synchronized sample slicer.'],
  deess:['De-essing amount','In the Infected sound path, reduces excessive high-frequency sibilance using a level-sensitive high-frequency component. Zero disables it. Legacy sound does not use this new control.'],
  strength:['Timing strength','Blends suggested positions toward the selected grid. Zero preserves every sample. Lower values keep more of the performer’s pocket; high values can sound rigid.'],
  maxMove:['Maximum timing move / ms','Limits how far a detected region may shift. Smaller values are safer for a nearly aligned take. Regions without enough surrounding silence may be left unchanged.'],
  division:['Timing grid division','Targets quarter, eighth, sixteenth or triplet note positions. Choose a division that matches the actual vocal rhythm, not just the beat’s tempo.'],
  swing:['Swing','Offsets alternating grid positions. Zero is straight. Positive values delay alternate targets; negative values anticipate them. Use intentionally, not to fix a wrong BPM.'],
  sensitivity:['Onset sensitivity','Controls the energy threshold used to locate active regions. Lower thresholds include quieter material and potentially noise. Compare the preview and keep the original.'],
  preserve:['Transient preservation','Reduces movement strength to protect articulation and groove. Higher values are more conservative. It does not recover a transient already clipped at recording.'],
  minGapMs:['Minimum onset gap / ms','Controls how close detected regions may be. Larger values tend to group phrases; smaller values can detect more syllables. Use preview to avoid fragmented phrasing.'],
  targetDb:['Target RMS proxy / dB','A repeatable loudness starting point based on sample RMS, not a certified LUFS value. Louder targets can invoke more compression or limiting. The output is still bounded by the ceiling.'],
  ceiling:['Sample-peak ceiling / dBFS','Upper sample amplitude of the master output. -1 dBFS leaves headroom for later encoding. This limiter does not certify oversampled intersample true peaks.'],
  masterCompression:['Master glue compression','Controls bus compression strength from 0 to 1. It affects the combined mix, not just the vocal. Use lightly after individual track balance is correct.'],
  width:['Stereo width','1 keeps normal width; 0 sums toward mono; values above 1 expand the side signal. Excess width can harm mono compatibility. Test on more than one playback system.'],
  masterDrive:['Master saturation','Adds harmonic drive to the stereo bus. It is applied before the final peak protection. High values can flatten transients; this is optional, not required for mastering.']
};
export const PRESET_HELP={
  'Clean rap':'A restrained vocal starting point: moderate correction and compression, light echo and room, no pitch lowering. Confirm the song key and reduce tuning for spoken rap.',
  'Grim':'A deliberately dark effect: lowered pitch, lower-octave layer, saturation and added body. Check consonant clarity and bass overlap before using it on an entire verse.',
  'Grim abyss':'An extreme version of the dark voice: deeper shift, heavier layer and drive, larger ambience. Intended as a creative effect, not a transparent vocal repair preset.',
  'Singing':'Slower pitch following and more ambience for sustained melodic lines. Confirm the key and reduce reverb if the mix becomes washed out.',
  'Hard tune':'Fast, full pitch correction for an intentionally synthetic melodic sound. It can expose a wrong key immediately. Lower the correction or increase retune time for a softer result.',
  'Acapella':'A drier, slower-corrected vocal starting point without echo/reverb. Useful when the voice stands alone or when another engineer will add space later.',
  'Natural rap':'Moderate sixteenth-note correction and small moves to retain the performer’s groove.',
  'Tight trap':'Stronger sixteenth-note correction with a little swing. Check intentional triplets before applying.',
  'Triplet flow':'An eighth-note triplet grid for three-part subdivisions. Do not use on straight rhythms merely because the song is trap.',
  'Balanced':'A conservative master with an RMS proxy target of -16 dB and -1 dB sample ceiling. A starting point for comparison.',
  'Rap':'A denser master starting point with moderate compression and a small amount of drive. Fix vocal/beat balance before mastering.',
  'Grim / EDM':'A more assertive master with stronger compression, slight width and saturation. Listen carefully for transient loss.',
  'Dynamic':'A quieter master with light compression and extra headroom, designed to preserve more level movement.'
};
export function describe(key,label){return HELP[key]||[label||key,'This control changes '+(label||key)+'. Changes affect the current project or selected track. Use Undo for arrangement and parameter edits, and keep a project backup before major changes.'];}

GUIDES.push(
  {id:'collab-people',title:'Collaboration · people and live changes',target:'peopleButton',paragraphs:[
    'People opens your two-artist room, chat, saved versions and publication review. A green Live connection badge means the event stream is connected; it does not certify low-latency audio.',
    'Your partner sees acknowledged draft edits without refreshing. Online elsewhere, In studio, Away and Offline are different states. If connection drops, edits stay local and need synchronization before Save or Exit.'
  ]},
  {id:'collab-invite',title:'Collaboration · invite and temporary names',target:'peopleButton',paragraphs:[
    'The creator invites one artist by email link. Copy link or Open email draft does not send an email automatically. Send email works only after the server’s email provider is configured.',
    'A guest uses a temporary name scoped to this room. The link is a private single-seat invitation; forwarding it gives access. Account holders can use a matching verified email. The future Universe profile uses the documented authenticated ticket bridge, not a fabricated live social integration.'
  ]},
  {id:'collab-ownership',title:'Collaboration · your tracks stay yours',target:'trackList',paragraphs:[
    'A partner’s tracks are read-only, including clip timing, presets, gain and tuning. The server checks ownership even if someone modifies the client. Both artists can hear the whole arrangement.',
    'In a room, Key, Scale, Sound and Pitch selectors affect only your selected track. Timing processing affects only your selected clip. Only the creator can change the shared tempo, grid or song title. Global mastering is a local preview until both artists approve the exact final render.'
  ]},
  {id:'collab-voice',title:'Collaboration · voice chat and recording',target:'voiceButton',paragraphs:[
    'Each artist explicitly switches voice chat on. Microphone permissions are requested only then. Voice transport uses WebRTC; a configured TURN relay is needed for reliable connectivity across restrictive networks.',
    'Use headphones. During recording your chat microphone and incoming chat audio are muted so conversation is not intentionally mixed into the take. The monitor is not a zero-latency internet jam system. Turn voice off or leave to release the call microphone.'
  ]},
  {id:'collab-save',title:'Collaboration · draft, save and exit',target:'collabExit',paragraphs:[
    'Live synchronization creates shared drafts; it is not the same as an explicit Save. Save my contribution commits only your part. Local project backups remain available and contain shared audio that you are authorized to hear.',
    'Exit without saving restores only your own last saved contribution. Your partner’s work is not reverted. Save then exit waits for your uploads and server acknowledgement. A conflict or disconnection blocks the exit rather than falsely claiming a save.'
  ]},
  {id:'collab-publish',title:'Collaboration · approve, publish and Universe',target:'peopleButton',paragraphs:[
    'The creator exports a WAV for review after both artists save. Both must confirm rights and approve the same saved version and render. Changing either contribution invalidates the approval.',
    'Publish then exit stores a creator-owned release and collaborator credits in this pilot. Its Universe publication event is queued, not delivered: the social service does not exist in this package. Guest contribution credit persists even after the temporary room session ends.'
  ]}
);
