// Every source the evidence page leans on. Each was opened and read on 13 Nov 2026; the sentence that supports each
// use is in pitch/claims.md. Order here is the order of the reference list on the page.

export interface Ref {
  /** how it is named in running text */
  short: string
  /** full reference line */
  full: string
  href: string
  doi?: string
}

const doi = (d: string) => `https://doi.org/${d}`

export const REFS = {
  // ---- the problem ----
  perera2016: {
    short: 'Perera 2016',
    full: 'Perera T, George MS, Grammer G, Janicak PG, Pascual-Leone A, Wirecki TS. The Clinical TMS Society consensus review and treatment recommendations for TMS therapy for major depressive disorder. Brain Stimul. 2016;9(3):336-346.',
    doi: '10.1016/j.brs.2016.03.010',
    href: doi('10.1016/j.brs.2016.03.010'),
  },
  senova2019: {
    short: 'Senova 2019',
    full: 'Senova S, Cotovio G, Pascual-Leone A, Oliveira-Maia AJ. Durability of antidepressant response to repetitive transcranial magnetic stimulation: systematic review and meta-analysis. Brain Stimul. 2019;12(1):119-128.',
    doi: '10.1016/j.brs.2018.10.001',
    href: doi('10.1016/j.brs.2018.10.001'),
  },
  janicak2010: {
    short: 'Janicak 2010',
    full: 'Janicak PG, Nahas Z, Lisanby SH, et al. Durability of clinical benefit with transcranial magnetic stimulation (TMS) in the treatment of pharmacoresistant major depression: assessment of relapse during a 6-month, multisite, open-label study. Brain Stimul. 2010;3(4):187-199.',
    doi: '10.1016/j.brs.2010.07.003',
    href: doi('10.1016/j.brs.2010.07.003'),
  },
  philip2016: {
    short: 'Philip 2016',
    full: 'Philip NS, Dunner DL, Dowd SM, et al. Can medication free, treatment-resistant, depressed patients who initially respond to TMS be maintained off medications? A prospective, 12-month multisite randomized pilot study. Brain Stimul. 2016;9(2):251-257.',
    doi: '10.1016/j.brs.2015.11.007',
    href: doi('10.1016/j.brs.2015.11.007'),
  },
  dine2026: {
    short: 'Dine 2026',
    full: 'Dine C, Rekkas Z, Frey BN, et al. Wearable-based assessment for relapse prediction following repetitive transcranial magnetic stimulation for depression: protocol for a feasibility study (WARN-D study). JMIR Res Protoc. 2026;15:e89466.',
    doi: '10.2196/89466',
    href: doi('10.2196/89466'),
  },
  // ---- the loop ----
  bylsma2008: {
    short: 'Bylsma 2008',
    full: 'Bylsma LM, Morris BH, Rottenberg J. A meta-analysis of emotional reactivity in major depressive disorder. Clin Psychol Rev. 2008;28(4):676-691.',
    doi: '10.1016/j.cpr.2007.10.001',
    href: doi('10.1016/j.cpr.2007.10.001'),
  },
  // ---- the four channels ----
  girard2014: {
    short: 'Girard 2014',
    full: 'Girard JM, Cohn JF, Mahoor MH, Mavadati SM, Hammal Z, Rosenwald DP. Nonverbal social withdrawal in depression: evidence from manual and automatic analysis. Image Vis Comput. 2014;32(10):641-647.',
    doi: '10.1016/j.imavis.2013.12.007',
    href: doi('10.1016/j.imavis.2013.12.007'),
  },
  mundt2007: {
    short: 'Mundt 2007',
    full: 'Mundt JC, Snyder PJ, Cannizzaro MS, Chappie K, Geralts DS. Voice acoustic measures of depression severity and treatment response collected via interactive voice response (IVR) technology. J Neurolinguistics. 2007;20(1):50-64.',
    doi: '10.1016/j.jneuroling.2006.04.001',
    href: doi('10.1016/j.jneuroling.2006.04.001'),
  },
  mundt2012: {
    short: 'Mundt 2012',
    full: 'Mundt JC, Vogel AP, Feltner DE, Lenderking WR. Vocal acoustic biomarkers of depression severity and treatment response. Biol Psychiatry. 2012;72(7):580-587.',
    doi: '10.1016/j.biopsych.2012.03.015',
    href: doi('10.1016/j.biopsych.2012.03.015'),
  },
  cummins2023: {
    short: 'Cummins 2023',
    full: 'Cummins N, Dineley J, Conde P, et al. Multilingual markers of depression in remotely collected speech samples: a preliminary analysis. J Affect Disord. 2023;341:128-136.',
    doi: '10.1016/j.jad.2023.08.097',
    href: doi('10.1016/j.jad.2023.08.097'),
  },
  iseger2017: {
    short: 'Iseger 2017',
    full: 'Iseger TA, Padberg F, Kenemans JL, Gevirtz R, Arns M. Neuro-Cardiac-Guided TMS (NCG-TMS): probing DLPFC-sgACC-vagus nerve connectivity using heart rate. First results. Brain Stimul. 2017;10(5):1006-1008.',
    doi: '10.1016/j.brs.2017.05.002',
    href: doi('10.1016/j.brs.2017.05.002'),
  },
  kaur2020: {
    short: 'Kaur 2020',
    full: 'Kaur M, Michael JA, Hoy KE, et al. Investigating high- and low-frequency neuro-cardiac-guided TMS for probing the frontal vagal pathway. Brain Stimul. 2020;13(3):931-938.',
    doi: '10.1016/j.brs.2020.03.002',
    href: doi('10.1016/j.brs.2020.03.002'),
  },
  iseger2020: {
    short: 'Iseger 2020',
    full: 'Iseger TA, Arns M, Downar J, Blumberger DM, Daskalakis ZJ, Vila-Rodriguez F. Cardiovascular differences between sham and active iTBS related to treatment response in MDD. Brain Stimul. 2020;13(1):167-174.',
    doi: '10.1016/j.brs.2019.09.016',
    href: doi('10.1016/j.brs.2019.09.016'),
  },
  feng2026: {
    short: 'Feng 2026',
    full: 'Feng ZJ, Martin S, Numssen O, et al. Target-specificity and repeatability in neuro-cardiac-guided TMS for heart-brain coupling. Transl Psychiatry. 2026;16:79.',
    doi: '10.1038/s41398-026-03879-w',
    href: doi('10.1038/s41398-026-03879-w'),
  },
  koch2019: {
    short: 'Koch 2019',
    full: 'Koch C, Wilhelm M, Salzmann S, Rief W, Euteneuer F. A meta-analysis of heart rate variability in major depression. Psychol Med. 2019;49(12):1948-1957.',
    doi: '10.1017/S0033291719001351',
    href: doi('10.1017/S0033291719001351'),
  },
  shields2009: {
    short: 'Shields 2009',
    full: 'Shields RW Jr. Heart rate variability with deep breathing as a clinical test of cardiovagal function. Cleve Clin J Med. 2009;76 Suppl 2:S37-40.',
    doi: '10.3949/ccjm.76.s2.08',
    href: doi('10.3949/ccjm.76.s2.08'),
  },
  // ---- the sensors ----
  wang2017: {
    short: 'Wang 2017',
    full: 'Wang W, den Brinker AC, Stuijk S, de Haan G. Algorithmic principles of remote PPG. IEEE Trans Biomed Eng. 2017;64(7):1479-1491.',
    doi: '10.1109/TBME.2016.2609282',
    href: doi('10.1109/TBME.2016.2609282'),
  },
  liu2023: {
    short: 'Liu 2023',
    full: 'Liu X, Narayanswamy G, Paruchuri A, et al. rPPG-Toolbox: deep remote PPG toolbox. NeurIPS 2023 Datasets and Benchmarks. arXiv:2210.00716 (Table 2).',
    href: 'https://arxiv.org/abs/2210.00716',
  },
  // ---- the personal model ----
  verma2021: {
    short: 'Verma 2021',
    full: 'Verma D, Bhalla S, Sahnan D, Shukla J, Parnami A. ExpressEar: sensing fine-grained facial expressions with earables. Proc ACM Interact Mob Wearable Ubiquitous Technol. 2021;5(3):1-28.',
    doi: '10.1145/3478085',
    href: doi('10.1145/3478085'),
  },
  roddiger2022: {
    short: 'Röddiger 2022',
    full: 'Röddiger T, Clarke C, Breitling P, et al. Sensing with earables: a systematic literature review and taxonomy of phenomena. Proc ACM Interact Mob Wearable Ubiquitous Technol. 2022;6(3):135.',
    doi: '10.1145/3550314',
    href: doi('10.1145/3550314'),
  },
  lee2019: {
    short: 'Lee 2019',
    full: 'Lee S, Min C, Montanari A, et al. Automatic smile and frown recognition with kinetic earables. Augmented Human International Conference 2019.',
    doi: '10.1145/3311823.3311869',
    href: doi('10.1145/3311823.3311869'),
  },
  appleNews: {
    short: 'Apple, Sept 2025',
    full: 'Apple Newsroom. Introducing AirPods Pro 3, the ultimate audio experience. 9 September 2025.',
    href: 'https://www.apple.com/newsroom/2025/09/introducing-airpods-pro-3-the-ultimate-audio-experience/',
  },
  appleSupport: {
    short: 'Apple Support',
    full: 'Apple Support. How to check your heart rate with AirPods Pro 3. Article 123184.',
    href: 'https://support.apple.com/en-us/123184',
  },
  appleMotion: {
    short: 'CMHeadphoneMotionManager',
    full: 'Apple Developer Documentation. CMHeadphoneMotionManager (Core Motion).',
    href: 'https://developer.apple.com/documentation/coremotion/cmheadphonemotionmanager',
  },
  appleWorkout: {
    short: 'HKWorkoutSession',
    full: 'Apple Developer Documentation. HKWorkoutSession (HealthKit).',
    href: 'https://developer.apple.com/documentation/healthkit/hkworkoutsession',
  },
  // ---- what the doses rest on ----
  pizzoli2021: {
    short: 'Pizzoli 2021',
    full: 'Pizzoli SFM, Marzorati C, Gatti D, Monzani D, Mazzocco K, Pravettoni G. A meta-analysis on heart rate variability biofeedback and depressive symptoms. Sci Rep. 2021;11:6650.',
    doi: '10.1038/s41598-021-86149-7',
    href: doi('10.1038/s41598-021-86149-7'),
  },
  noetel2024: {
    short: 'Noetel 2024',
    full: 'Noetel M, Sanders T, Gallardo-Gómez D, et al. Effect of exercise for depression: systematic review and network meta-analysis of randomised controlled trials. BMJ. 2024;384:e075847.',
    doi: '10.1136/bmj-2023-075847',
    href: doi('10.1136/bmj-2023-075847'),
  },
  buxton2021: {
    short: 'Buxton 2021',
    full: 'Buxton RT, Pearson AL, Allou C, Fristrup K, Wittemyer G. A synthesis of health benefits of natural sounds and their distribution in national parks. Proc Natl Acad Sci USA. 2021;118(14):e2013097118.',
    doi: '10.1073/pnas.2013097118',
    href: doi('10.1073/pnas.2013097118'),
  },
  coles2022: {
    short: 'Coles 2022',
    full: 'Coles NA, March DS, Marmolejo-Ramos F, et al. A multi-lab test of the facial feedback hypothesis by the Many Smiles Collaboration. Nat Hum Behav. 2022;6(12):1731-1742.',
    doi: '10.1038/s41562-022-01458-9',
    href: doi('10.1038/s41562-022-01458-9'),
  },
  // ---- closed-loop TMS at Aalto ----
  tervo2022: {
    short: 'Tervo 2022',
    full: 'Tervo AE, Nieminen JO, Lioumis P, et al. Closed-loop optimization of transcranial magnetic stimulation with electroencephalography feedback. Brain Stimul. 2022;15(2):523-531.',
    doi: '10.1016/j.brs.2022.01.016',
    href: doi('10.1016/j.brs.2022.01.016'),
  },
  ukharova2026: {
    short: 'Ukharova 2026',
    full: 'Ukharova E, O’Meeghan I, Granö I, et al. Individualized TMS-EEG mapping reveals clinically relevant early prefrontal cortical activity in major depressive disorder. Clin Neurophysiol. 2026;193:2112427.',
    doi: '10.1016/j.clinph.2026.2112427',
    href: doi('10.1016/j.clinph.2026.2112427'),
  },
  sayali2026: {
    short: 'Sayalı 2026',
    full: 'Sayalı C, Gogulski J, Granö I, et al. Test-retest reliability of early TMS-evoked potentials over fMRI-based definitions of non-motor targets. Clin Neurophysiol. 2026;190:2112327.',
    doi: '10.1016/j.clinph.2026.2112327',
    href: doi('10.1016/j.clinph.2026.2112327'),
  },
} satisfies Record<string, Ref>

export type RefKey = keyof typeof REFS
export const REF_KEYS = Object.keys(REFS) as RefKey[]
