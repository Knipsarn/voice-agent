# CATEGORY_POLICIES

---

## [ARBETSRÄTT]
TRIGGERS: jobb, arbete, chef, uppsagd, varsel, schema, pass, lön, anställningsavtal, anställning

SUBTYPE: uppsägning/avsked/varsel | uteblivna pass/schemaförändring | lön/ersättning | annat arbetsrelaterat

MINIMUM-FRÅGOR:
1. "Gäller det främst att du riskerar att förlora jobbet, eller något annat kring dina villkor?" → subtype
2. "Har du fått något skriftligt, till exempel uppsägning, varsel eller förändrade villkor?" → maturity, has_written_notice
3. "Har du något anställningsavtal eller liknande dokumentation?" → document_status

---

## [BOSTAD / HYRESRÄTT]
TRIGGERS: hyr lägenhet, hyresvärd, bostad, hyreskontrakt, uppsagd som hyresgäst, mögel, läcka, standard, störningsbrev

SUBTYPE: standard/brister | uppsägningshot/varning | kombination

MINIMUM-FRÅGOR:
1. "Gäller det skicket på lägenheten, hot om att förlora bostaden, eller båda?" → subtype
2. "Har du fått något skriftligt från hyresvärden?" → maturity, has_written_notice
3. "Finns det dokumentation om bristerna — felanmälningar, mejl, bilder?" → document_status

---

## [TVIST — PENGAR / TJÄNST / VARA]
TRIGGERS: faktura, skuld, inte betalat, vill inte betala, renovering, hantverkare, tvist, stämma, dolt fel

SUBTYPE: tjänst | vara/köp | fordran/skuld | dolt fel

MINIMUM-FRÅGOR:
1. "Gäller det en tjänst, en vara du köpt, eller en skuld/fordran?" → subtype
2. "Ungefär hur stort belopp handlar det om?" → bedömning
3. "Finns det en skriftlig överenskommelse — offert, avtal, mejl eller fakturor?" → document_status

---

## [AVTAL / GDPR / B2B]
TRIGGERS: avtal, kontrakt, villkor, samarbetsavtal, kundavtal, GDPR, personuppgifter, integritetspolicy

SUBTYPE: nytt avtal | granskning av befintligt avtal | GDPR-dokumentation | kombination

MINIMUM-FRÅGOR:
1. "Gäller det att ta fram nya avtal, granska befintliga, eller GDPR-dokumentation?" → subtype
2. "Har ni redan avtal eller GDPR-texter ni använder, eller börjar vi från grunden?" → document_status

---

## [FAMILJERÄTT]
TRIGGERS: skiljas, gifta, sambo, bodelning, barn, vårdnad, underhåll, äktenskapsförord, samboavtal

SUBTYPE: skilsmässa + bodelning | sambo + bostad | vårdnad/umgänge | äktenskapsförord/samboavtal

MINIMUM-FRÅGOR:
1. "Gäller det er relation, bostad och ekonomi, eller frågor om barn och vårdnad?" → subtype
2. "Är ni gifta eller sambos?" → avgör spår
3. "Finns det något avtal sedan tidigare?" → document_status

---

## [ARV / TESTAMENTE / FRAMTIDSFULLMAKT]
TRIGGERS: testamente, arv, dödsbo, bouppteckning, framtidsfullmakt, arvinge

SUBTYPE: upprätta testamente | bouppteckning/arvskifte | framtidsfullmakt | arvstvist

MINIMUM-FRÅGOR:
1. "Gäller det att upprätta ett testamente, eller ett arv/dödsbo som redan är öppnat?" → subtype
2. "Finns det redan något dokument — testamente, bouppteckning?" → document_status

---

## [SKATTERÄTT]
TRIGGERS: skatt, deklaration, Skatteverket, moms, F-skatt, skattetvist, kapitalvinstskatt

SUBTYPE: deklaration/rättning | tvist med Skatteverket | momshantering | F-skatt/företagsskatt

MINIMUM-FRÅGOR:
1. "Gäller det din privata deklaration, företagets skatter, eller en tvist med Skatteverket?" → subtype
2. "Har du fått något skriftligt från Skatteverket?" → has_written_notice, maturity

---

## [MIGRATIONSRÄTT]
TRIGGERS: uppehållstillstånd, migration, visum, asyl, medborgarskap, Migrationsverket, arbetstillstånd, familjeåterförening

SUBTYPE: uppehållstillstånd | arbetstillstånd | asyl | medborgarskap | överklagande | familjeåterförening

MINIMUM-FRÅGOR:
1. "Gäller det uppehållstillstånd, arbetstillstånd, asyl, medborgarskap, eller något annat?" → subtype
2. "Har du fått ett beslut från Migrationsverket, eller ansöker du om något nytt?" → maturity

---

## [FASTIGHETSRÄTT]
TRIGGERS: köpa hus, sälja hus, fastighet, tomt, villa, fritidshus, lagfart, servitut, granne

SUBTYPE: köp/försäljning | dolda fel vid köp | granntvist/servitut | arrende

MINIMUM-FRÅGOR:
1. "Gäller det ett köp/försäljning, eller ett problem med en fastighet du redan äger?" → subtype
2. "Finns det ett köpekontrakt, besiktningsprotokoll eller annat skriftligt underlag?" → document_status

---

## [BOSTADSRÄTTSFÖRENING]
TRIGGERS: bostadsrättsförening, HSB, brf, styrelse, stadgar, förening, föreningsstämma

SUBTYPE: stadgar/stadgeändring | styrelsearbete | tvist boende/förening | föreningsstämma

MINIMUM-FRÅGOR:
1. "Representerar du föreningen (styrelsen) eller är du som bostadsrättshavare i tvist med föreningen?" → perspektiv
2. "Gäller det stadgar, styrelsearbete, en stämma, eller en tvist?" → subtype

---

## [ENTREPRENADR ÄTT]
TRIGGERS: byggprojekt, totalentreprenad, ABT, AB04, anbud, byggherre, underentreprenör, ÄTA, vite

SUBTYPE: ÄTA-arbeten | vite/dröjsmål | fel efter besiktning | avtal/anbudsprocess

MINIMUM-FRÅGOR:
1. "Är ni beställare (byggherre) eller utförare (entrepreneur)?" → perspektiv
2. "Finns det ett entreprenadr ätt-avtal — ABT 06, AB 04, eller eget avtal?" → document_status

---

## [IT-RÄTT]
TRIGGERS: IT, mjukvara, apputveckling, licensavtal, SaaS, källkod, dataskydd, domännamn

SUBTYPE: licensavtal/SaaS-avtal | apputvecklingsavtal | dataskydd/GDPR | tvist leverantör

MINIMUM-FRÅGOR:
1. "Gäller det att ta fram/granska ett avtal, lösa en tvist, eller dataskyddsfrågor?" → subtype
2. "Finns det ett befintligt avtal eller ska ett nytt skrivas?" → document_status

---

## [OFFENTLIG UPPHANDLING]
TRIGGERS: upphandling, LOU, LUF, offentlig sektor, anbud myndighet, ramavtal, överprövning

SUBTYPE: anbud/anbudsprocess | överprövning av tilldelning | ramavtalstvist

MINIMUM-FRÅGOR:
1. "Är ni leverantör som deltar i en upphandling, eller en upphandlande myndighet?" → perspektiv
2. "Gäller det att lämna anbud, överklaga ett tilldelningsbeslut, eller något annat?" → subtype

---

## [PLAN- OCH BYGGLAGEN]
TRIGGERS: bygglov, detaljplan, PBL, plan- och bygglagen, strandskydd, attefallsåtgärd

SUBTYPE: bygglovsansökan | överklagande av beslut | detaljplaneärende | strandskyddsdispens

MINIMUM-FRÅGOR:
1. "Gäller det att ansöka om bygglov, överklaga ett beslut, eller ett annat planärende?" → subtype
2. "Har du fått ett skriftligt beslut?" → has_written_notice
