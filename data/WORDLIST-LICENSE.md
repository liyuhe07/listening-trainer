# Offline core-English exclusion reference

`wordlist.json` contains **4,836 unique lowercase entries**. It is a reference used to exclude common/general/academic/practical English from automatically suggested vocabulary candidates. It is **not an official IELTS word list**, not an IELTS coverage guarantee, and not evidence that a particular learner knows any entry. It contains no definitions, Chinese translations, glosses, or audio/transcript content.

## Primary sources and attribution

All four downloads are linked from the official New General Service List Project website and were retrieved on 2026-09-13.

| Component | Entries before deduplication | Creators credited by source | Official source / license evidence |
|---|---:|---|---|
| New General Service List 1.2 | 2,809 | Browne, C., Culligan, B., and Phillips, J. | https://www.newgeneralservicelist.com/new-general-service-list |
| New Academic Word List 1.2 | 957 | Browne, C., Culligan, B., and Phillips, J. | https://www.newgeneralservicelist.com/new-academic-word-list |
| TOEIC Service List 1.2 | 1,250 | Browne, C. and Culligan, B. | https://www.newgeneralservicelist.com/toeic-service-list |
| NGSL supplementary headwords (days, months, numbers) | 52 | NGSL creators above | https://www.newgeneralservicelist.com/new-general-service-list |

Each of the three official source pages has a “CREATIVE COMMONS LICENSE” section explicitly identifying its word list as licensed under Creative Commons Attribution-ShareAlike 4.0 International. The NGSL page links the supplement as “NGSL SUPPLEMENTARY WORDS” and identifies these 52 words as part of the NGSL.

**License for this adapted vocabulary data: [Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0)](https://creativecommons.org/licenses/by-sa/4.0/).** Retain this attribution, source links, license link, and modification notice when sharing the data. The data license is recorded separately from any consuming application's code license. No creator endorsement is implied.

## Adaptation and counting

Only the headword lists were extracted. Introductory descriptions, TSL numbering, and the supplement's extra inflection columns were removed. Entries were lowercased, deduplicated, and sorted. No entries were fabricated or padded. NGSL + NAWL + TSL yields 4,786 unique entries; the 52 supplementary headwords add 50 new entries, giving 4,836.

Spelling was preserved, including `café`, `entrée`, and `résumé`. `ice cream` remains one source entry. Counts are unique entries/headwords, not word families, all surface inflections, or tokens. `wordlist.json` embeds the exact source component URLs and modification list.

A consumer should normalize/lemmatize candidate words or offer manual adjustment: exact matching alone can treat plural/past-tense forms or British/American spelling variants as outside the list. Automated candidates should remain editable. The TSL component is openly identified as TOEIC-oriented practical English; it is included to broaden the general/academic reference, not relabeled as IELTS material.

## Reproduction

The build script and raw downloads are not included in this repository.
