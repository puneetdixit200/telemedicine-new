const LABELS = Object.freeze({
  en: { category: 'Care update', minimize: 'Minimize', expand: 'Open updates', rebook: 'Rebook appointment', open: 'Open appointment', dismiss: 'Dismiss', available: 'Available times', more: 'more updates waiting' },
  as: { category: 'যত্নৰ আপডেট', minimize: 'সৰু কৰক', expand: 'আপডেট খোলক', rebook: 'এপইণ্টমেণ্ট পুনৰ বুক কৰক', open: 'এপইণ্টমেণ্ট খোলক', dismiss: 'বন্ধ কৰক', available: 'উপলব্ধ সময়', more: 'টা অধিক আপডেট অপেক্ষাৰত' },
  bn: { category: 'যত্নের আপডেট', minimize: 'ছোট করুন', expand: 'আপডেট খুলুন', rebook: 'অ্যাপয়েন্টমেন্ট আবার বুক করুন', open: 'অ্যাপয়েন্টমেন্ট খুলুন', dismiss: 'বন্ধ করুন', available: 'উপলব্ধ সময়', more: 'টি আরও আপডেট অপেক্ষমাণ' },
  brx: { category: 'लायनायनि आपडेट', minimize: 'फिसा खालाम', expand: 'आपडेट खेव', rebook: 'अपोइंटमेन्ट फिन बुक खालाम', open: 'अपोइंटमेन्ट खेव', dismiss: 'बन्द खालाम', available: 'मोननो हानाय सम', more: 'गोबां आपडेट थाबाय' },
  doi: { category: 'देखभाल अपडेट', minimize: 'घट्ट करो', expand: 'अपडेट खोलो', rebook: 'मुलाकात दुबारा बुक करो', open: 'मुलाकात खोलो', dismiss: 'बंद करो', available: 'उपलब्ध समां', more: 'होर अपडेट इंतजार च' },
  gu: { category: 'સંભાળ અપડેટ', minimize: 'નાનું કરો', expand: 'અપડેટ ખોલો', rebook: 'મુલાકાત ફરી બુક કરો', open: 'મુલાકાત ખોલો', dismiss: 'બંધ કરો', available: 'ઉપલબ્ધ સમય', more: 'વધુ અપડેટ બાકી' },
  hi: { category: 'देखभाल अपडेट', minimize: 'छोटा करें', expand: 'अपडेट खोलें', rebook: 'अपॉइंटमेंट दोबारा बुक करें', open: 'अपॉइंटमेंट खोलें', dismiss: 'हटाएँ', available: 'उपलब्ध समय', more: 'और अपडेट बाकी हैं' },
  kn: { category: 'ಆರೈಕೆ ಮಾಹಿತಿ', minimize: 'ಚಿಕ್ಕದಾಗಿಸಿ', expand: 'ಮಾಹಿತಿ ತೆರೆಯಿರಿ', rebook: 'ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಮರುಬುಕ್ ಮಾಡಿ', open: 'ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ತೆರೆಯಿರಿ', dismiss: 'ಮುಚ್ಚಿ', available: 'ಲಭ್ಯವಿರುವ ಸಮಯ', more: 'ಹೆಚ್ಚಿನ ಮಾಹಿತಿಗಳು ಬಾಕಿ' },
  ks: { category: 'نگہداشت اپڈیٹ', minimize: 'کَم کٔرِو', expand: 'اپڈیٹ کھولِو', rebook: 'اپوٲنٹمٮ۪نٹ دوبارٕ بُک کٔرِو', open: 'اپوٲنٹمٮ۪نٹ کھولِو', dismiss: 'بند کٔرِو', available: 'دستیاب وقت', more: 'مزید اپڈیٹ باقی' },
  kok: { category: 'देखरेख अपडेट', minimize: 'ल्हान करात', expand: 'अपडेट उगडात', rebook: 'भेट परत बुक करात', open: 'भेट उगडात', dismiss: 'बंद करात', available: 'उपलब्ध वेळ', more: 'आनी अपडेट बाकी' },
  mai: { category: 'देखभाल अपडेट', minimize: 'छोट करू', expand: 'अपडेट खोलू', rebook: 'अपॉइंटमेंट फेर बुक करू', open: 'अपॉइंटमेंट खोलू', dismiss: 'बन्द करू', available: 'उपलब्ध समय', more: 'आओर अपडेट बाँकी' },
  ml: { category: 'പരിചരണ വിവരം', minimize: 'ചുരുക്കുക', expand: 'വിവരം തുറക്കുക', rebook: 'അപ്പോയിന്റ്മെന്റ് വീണ്ടും ബുക്ക് ചെയ്യുക', open: 'അപ്പോയിന്റ്മെന്റ് തുറക്കുക', dismiss: 'അടയ്ക്കുക', available: 'ലഭ്യമായ സമയം', more: 'കൂടുതൽ വിവരങ്ങൾ കാത്തിരിക്കുന്നു' },
  mni: { category: 'ꯌꯦꯡꯁꯤꯟꯕꯒꯤ ꯑꯄꯗꯦꯠ', minimize: 'ꯄꯤꯛꯊꯍꯟꯕ', expand: 'ꯑꯄꯗꯦꯠ ꯍꯥꯡꯗꯣꯛꯄ', rebook: 'ꯑꯄꯣꯏꯟꯇꯃꯦꯟꯇ ꯑꯃꯨꯛ ꯕꯨꯛ ꯇꯧꯕ', open: 'ꯑꯄꯣꯏꯟꯇꯃꯦꯟꯇ ꯍꯥꯡꯗꯣꯛꯄ', dismiss: 'ꯂꯣꯏꯁꯤꯟꯕ', available: 'ꯐꯪꯂꯤꯕ ꯃꯇꯝ', more: 'ꯑꯄꯗꯦꯠ ꯑꯍꯦꯟꯕ ꯂꯩ' },
  mr: { category: 'देखभाल अपडेट', minimize: 'लहान करा', expand: 'अपडेट उघडा', rebook: 'अपॉइंटमेंट पुन्हा बुक करा', open: 'अपॉइंटमेंट उघडा', dismiss: 'बंद करा', available: 'उपलब्ध वेळा', more: 'अधिक अपडेट बाकी' },
  ne: { category: 'हेरचाह अपडेट', minimize: 'सानो बनाउनुहोस्', expand: 'अपडेट खोल्नुहोस्', rebook: 'अपोइन्टमेन्ट पुनः बुक गर्नुहोस्', open: 'अपोइन्टमेन्ट खोल्नुहोस्', dismiss: 'बन्द गर्नुहोस्', available: 'उपलब्ध समय', more: 'थप अपडेट बाँकी' },
  or: { category: 'ଯତ୍ନ ସୂଚନା', minimize: 'ଛୋଟ କରନ୍ତୁ', expand: 'ସୂଚନା ଖୋଲନ୍ତୁ', rebook: 'ଆପଏଣ୍ଟମେଣ୍ଟ ପୁଣି ବୁକ୍ କରନ୍ତୁ', open: 'ଆପଏଣ୍ଟମେଣ୍ଟ ଖୋଲନ୍ତୁ', dismiss: 'ବନ୍ଦ କରନ୍ତୁ', available: 'ଉପଲବ୍ଧ ସମୟ', more: 'ଅଧିକ ସୂଚନା ବାକି' },
  pa: { category: 'ਦੇਖਭਾਲ ਅਪਡੇਟ', minimize: 'ਛੋਟਾ ਕਰੋ', expand: 'ਅਪਡੇਟ ਖੋਲ੍ਹੋ', rebook: 'ਮੁਲਾਕਾਤ ਦੁਬਾਰਾ ਬੁੱਕ ਕਰੋ', open: 'ਮੁਲਾਕਾਤ ਖੋਲ੍ਹੋ', dismiss: 'ਬੰਦ ਕਰੋ', available: 'ਉਪਲਬਧ ਸਮਾਂ', more: 'ਹੋਰ ਅਪਡੇਟ ਬਾਕੀ' },
  sa: { category: 'परिचर्या सूचना', minimize: 'लघु कुरुत', expand: 'सूचनां उद्घाटयत', rebook: 'भेटीं पुनः आरक्षयत', open: 'भेटीं उद्घाटयत', dismiss: 'पिधत्त', available: 'उपलब्ध समयः', more: 'अधिकाः सूचनाः अवशिष्टाः' },
  sat: { category: 'ᱡᱚᱛᱚᱱ ᱟᱯᱰᱮᱴ', minimize: 'ᱦᱩᱰᱤᱧ ᱢᱮ', expand: 'ᱟᱯᱰᱮᱴ ᱡᱷᱤᱡ ᱢᱮ', rebook: 'ᱟᱯᱚᱭᱮᱱᱴᱢᱮᱱᱴ ᱫᱚᱦᱲᱟ ᱵᱩᱠ ᱢᱮ', open: 'ᱟᱯᱚᱭᱮᱱᱴᱢᱮᱱᱴ ᱡᱷᱤᱡ ᱢᱮ', dismiss: 'ᱵᱚᱱᱫ ᱢᱮ', available: 'ᱯᱷᱟᱶ ᱚᱠᱛᱚ', more: 'ᱟᱨᱦᱚᱸ ᱟᱯᱰᱮᱴ ᱢᱮᱱᱟᱜᱼᱟ' },
  sd: { category: 'سنڀال اپڊيٽ', minimize: 'ننڍو ڪريو', expand: 'اپڊيٽ کوليو', rebook: 'اپائنٽمينٽ ٻيهر بڪ ڪريو', open: 'اپائنٽمينٽ کوليو', dismiss: 'بند ڪريو', available: 'دستياب وقت', more: 'وڌيڪ اپڊيٽ باقي' },
  ta: { category: 'பராமரிப்பு தகவல்', minimize: 'சுருக்குக', expand: 'தகவலைத் திறக்கவும்', rebook: 'சந்திப்பை மீண்டும் பதிவு செய்யவும்', open: 'சந்திப்பைத் திறக்கவும்', dismiss: 'மூடுக', available: 'கிடைக்கும் நேரங்கள்', more: 'மேலும் தகவல்கள் காத்திருக்கின்றன' },
  te: { category: 'సంరక్షణ సమాచారం', minimize: 'చిన్నదిగా చేయండి', expand: 'సమాచారం తెరవండి', rebook: 'అపాయింట్‌మెంట్‌ను మళ్లీ బుక్ చేయండి', open: 'అపాయింట్‌మెంట్ తెరవండి', dismiss: 'మూసివేయండి', available: 'అందుబాటులో ఉన్న సమయాలు', more: 'మరిన్ని సమాచారం మిగిలి ఉంది' },
  ur: { category: 'نگہداشت کی اطلاع', minimize: 'چھوٹا کریں', expand: 'اطلاعات کھولیں', rebook: 'اپائنٹمنٹ دوبارہ بک کریں', open: 'اپائنٹمنٹ کھولیں', dismiss: 'بند کریں', available: 'دستیاب اوقات', more: 'مزید اطلاعات باقی ہیں' }
});

export function getPatientNotificationLabels(languageCode) {
  return LABELS[String(languageCode || '').toLowerCase()] || LABELS.hi;
}

export default LABELS;
