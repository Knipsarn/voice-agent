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

---

## [ARV / TESTAMENTE / FRAMTIDSFULLMAKT]
TRIGGERS: testamente, arv, dödsbo, bouppteckning, framtidsfullmakt, förmyndare, arvinge

SUBTYPE: upprätta testamente | granska/ändra testamente | bouppteckning/arvskifte | framtidsfullmakt | arvstvist

MINIMUM-FRÅGOR:
1. "Gäller det att upprätta ett nytt testamente, eller handlar det om ett arv eller dödsbo som redan är öppnat?" → subtype
2. "Finns det redan något dokument – ett testamente, en bouppteckning eller ett arvsavtal?" → document_status
3. "Är det pågående nu, eller är du i planeringsstadiet?" → maturity

---

## [SKATTERÄTT]
TRIGGERS: skatt, deklaration, Skatteverket, moms, F-skatt, skattebrott, skattetvist, skatteåterbäring, kapitalvinstskatt

SUBTYPE: deklaration/rättning | tvist med Skatteverket | momshantering | F-skatt/företagsskatt | skatteplanering

MINIMUM-FRÅGOR:
1. "Gäller det din privata deklaration, företagets skatter, eller en tvist med Skatteverket?" → subtype
2. "Har du fått något skriftligt från Skatteverket, till exempel ett beslut eller ett föreläggande?" → has_written_notice, maturity
3. "Handlar det om ett specifikt belopp eller en tidsperiod?" → bedömning

---

## [MIGRATIONSRÄTT]
TRIGGERS: uppehållstillstånd, migration, visum, asyl, medborgarskap, Migrationsverket, deportation, arbetstillstånd, familjeåterförening

SUBTYPE: uppehållstillstånd | arbetstillstånd | asyl | medborgarskap | överklagande Migrationsverket | familjeåterförening

MINIMUM-FRÅGOR:
1. "Gäller det ett uppehållstillstånd, arbetstillstånd, asyl, medborgarskap, eller något annat?" → subtype
2. "Har du fått ett beslut från Migrationsverket som du vill överklaga, eller ansöker du om något nytt?" → maturity, has_written_notice
3. "Har du beslutet eller ansökan i skriftlig form?" → document_status

---

## [FASTIGHETSRÄTT]
TRIGGERS: köpa hus, sälja hus, fastighet, tomt, villa, fritidshus, inteckning, lagfart, servitut, granne, gräns

SUBTYPE: köp/försäljning | dolda fel vid köp | granntvist/servitut | inteckning/lagfart | arrende

MINIMUM-FRÅGOR:
1. "Gäller det ett köp eller en försäljning av fastighet, eller handlar det om ett problem med en fastighet du redan äger?" → subtype
2. "Är det ett hus, tomt, fritidshus, eller något annat?" → subtype
3. "Finns det ett köpekontrakt, besiktningsprotokoll eller annat skriftligt underlag?" → document_status

---

## [BOSTADSRÄTTSFÖRENING]
TRIGGERS: bostadsrättsförening, HSB, brf, styrelse, stadgar, förening, stämma, underhåll förening, andrahandsuthyrning förening

SUBTYPE: stadgar/stadgeändring | styrelsearbete | tvist mellan boende och förening | andrahandsuthyrning | föreningsstämma

MINIMUM-FRÅGOR:
1. "Representerar du föreningen (styrelsen) eller är du som bostadsrättshavare i tvist med föreningen?" → perspektiv
2. "Gäller det stadgar, styrelsearbete, en stämma, eller en tvist?" → subtype
3. "Finns det skriftliga handlingar – stadgar, stämmobeslut eller skriftlig kommunikation?" → document_status

---

## [ENTREPRENADR ÄTT]
TRIGGERS: byggprojekt, entrepreneur, totalentreprenad, ABT, AB04, anbud, byggherre, underentreprenör, ÄTA, vite, besiktning bygg

SUBTYPE: ÄTA-arbeten/tillägg | vite/dröjsmål | fel efter besiktning | avtal/anbudsprocess | tvist underentreprenör

MINIMUM-FRÅGOR:
1. "Är ni beställare (byggherre) eller utförare (entrepreneur) i det här projektet?" → perspektiv
2. "Gäller det tvister om utfört arbete, avtalsskrivning, eller något annat?" → subtype
3. "Finns det ett entreprenadr ätt-avtal – till exempel ABT 06, AB 04, eller ett eget avtal?" → document_status

---

## [IT-RÄTT]
TRIGGERS: IT, mjukvara, apputveckling, licensavtal, SaaS, källkod, dataskydd, cybersäkerhet, domännamn, e-handel

SUBTYPE: licensavtal/SaaS-avtal | apputvecklingsavtal | dataskydd/GDPR | personuppgiftsbiträdesavtal | tvist leverantör

MINIMUM-FRÅGOR:
1. "Gäller det att ta fram eller granska ett avtal, lösa en tvist, eller hantera dataskyddsfrågor?" → subtype
2. "Handlar det om en intern lösning eller ett avtal med en extern leverantör/kund?" → kontext
3. "Finns det ett befintligt avtal eller är det ett nytt som ska skrivas?" → document_status

---

## [OFFENTLIG UPPHANDLING]
TRIGGERS: upphandling, LOU, LUF, offentlig sektor, anbud myndighet, ramavtal, direktupphandling, överprövning

SUBTYPE: anbud/anbudsprocess | överprövning av tilldelning | ramavtalstvist | direktupphandling

MINIMUM-FRÅGOR:
1. "Är ni leverantör som deltar i en upphandling, eller är ni en upphandlande myndighet?" → perspektiv
2. "Gäller det att lämna anbud, överklaga ett tilldelningsbeslut, eller något annat?" → subtype
3. "Har ni fått ett tilldelningsbeslut eller annan skriftlig kommunikation?" → has_written_notice

---

## [PLAN- OCH BYGGLAGEN / BYGGLOV]
TRIGGERS: bygglov, detaljplan, PBL, plan- och bygglagen, överklagande plan, mark, exploatering, strandskydd, attefallsåtgärd

SUBTYPE: bygglovsansökan | överklagande av beslut | detaljplaneärende | strandskyddsdispens | attefallsåtgärd

MINIMUM-FRÅGOR:
1. "Gäller det att ansöka om bygglov, överklaga ett beslut, eller något annat planärende?" → subtype
2. "Har du fått ett skriftligt beslut som du vill överklaga?" → has_written_notice, maturity
3. "Gäller det en privatbostad, ett företag eller ett markprojekt?" → kontext
