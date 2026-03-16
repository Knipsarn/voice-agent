# CATEGORY_POLICIES

---

## [ARBETSRÄTT]
TRIGGERS: jobb, arbete, chef, uppsagd, varsel, schema, pass, lön, anställningsavtal

SUBTYPE: uppsägning/avsked/varsel | uteblivna pass/schemaförändring | lön/ersättning | annat arbetsrelaterat

MINIMUM-FRÅGOR:
1. "För att koppla dig rätt – gäller det främst att du riskerar att förlora jobbet, eller något annat kring dina villkor?" → subtype
2. "Har du fått något skriftligt, till exempel uppsägning, varsel eller förändrade villkor? Om ja: när kom det?" → maturity, has_written_notice
3. "Har du något anställningsavtal eller liknande dokumentation kring anställningen?" → document_status

DOKUMENTSTATUS-FRÅGA:
"När det gäller ditt anställningsavtal – har du något skriftligt avtal, eller bygger allt på muntliga överenskommelser?"

---

## [BOSTAD / HYRESRÄTT]
TRIGGERS: hyr lägenhet, hyresvärd, bostad, hyreskontrakt, uppsagd som hyresgäst, mögel, läcka, standard, störningsbrev

SUBTYPE: standard/brister (mögel, läckor, hälsa) | uppsägningshot/varning/störningsärende | kombination standard + uppsägningshot

MINIMUM-FRÅGOR:
1. "Det du beskriver – gäller det främst skicket på lägenheten, hot om att förlora bostaden, eller båda delarna?" → subtype
2. "Har du fått något skriftligt från hyresvärden, till exempel varning eller brev där uppsägning nämns?" → maturity, has_written_notice
3. "Har du någon dokumentation om bristerna – felanmälningar, mejl, chattar, bilder?" → document_status

DOKUMENTSTATUS-FRÅGA:
"När det gäller problemen i lägenheten – finns det felanmälningar eller mejl, eller har allt skett muntligt?"
"När det gäller brevet om störningar – har du det sparat, eller bara läst det?"

---

## [TVIST — PENGAR / TJÄNST / VARA]
TRIGGERS: faktura, skuld, inte betalat, vill inte betala, renovering, hantverkare, tvist, stämma

SUBTYPE: tjänst (renovering, hantverk) | vara/köp | fordran/skuld | annat

MINIMUM-FRÅGOR:
1. "Gäller det främst en tjänst som utförts (t.ex. renovering), en vara du köpt, eller en skuld/fordran?" → subtype
2. "Ungefär hur stort belopp handlar det om totalt?" → bedömning utan råd
3. "Finns det någon skriftlig överenskommelse – offert, avtal, mejl eller fakturor?" → document_status

---

## [AVTAL / GDPR / B2B]
TRIGGERS: avtal, kontrakt, villkor, samarbetsavtal, kundavtal, GDPR, personuppgifter, integritetspolicy, AI som behandlar data

SUBTYPE: nytt avtal (B2B, kund, leverantör) | granskning av befintligt avtal | GDPR-dokumentation | kombination

MINIMUM-FRÅGOR:
1. "Gäller det främst att ta fram nya avtal, få befintliga avtal granskade, få ordning på GDPR-dokumentation, eller en kombination?" → subtype
2. "När det gäller ert störst akuta behov – är det juridiskt hållbara avtal med kunder/partners, eller att säkerställa att behandlingen av personuppgifter följer GDPR?" → main_goal
3. "Har ni redan några avtal eller GDPR-texter som ni använder i dag, eller börjar vi helt från ett blankt papper?" → document_status

DOKUMENTSTATUS-FRÅGA:
"När det gäller GDPR-dokumenten du nämnde – har ni något nu (policy, biträdesavtal, info-texter), eller saknas allt?"
"När det gäller affärsavtalet – finns det något utkast, eller behöver det tas fram helt från grunden?"

---

## [FAMILJERÄTT]
TRIGGERS: skiljas, gifta, sambo, bodelning, barn, vårdnad, underhåll

SUBTYPE: skilsmässa + bodelning | sambo + bostad/boende | vårdnad/umgänge/boende för barn | äktenskapsförord/samboavtal

MINIMUM-FRÅGOR:
1. "Gäller det främst er relation (skilsmässa/samboseparation), bostad och ekonomi, eller frågor om barn och vårdnad?" → subtype
2. "Är ni gifta eller sambos?" → avgör spår
3. "Har ni något avtal sedan tidigare, till exempel äktenskapsförord eller samboavtal?" → document_status
