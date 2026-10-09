/* Exam profiles: one entry per certification.
   Used by the launcher (index.html) and by assets/engine.js on exam pages. */
(function () {
  const qRange = n => Array.from({ length: n }, (_, i) => "q" + (i + 1));

  window.EXAM_PROFILES = {
    terraform: {
      href: "terraform.html",
      storage: { ui: "exam-ui-v2:terraform-associate-004", progress: "exam-progress:terraform-associate-004:v1" },
      all: qRange(28),
      // NOTE: grouped by ExamTopics topic, not yet by official domain (phase 2)
      domains: {"1":["q1","q2","q3"],"2":["q4","q5","q6","q7","q8","q9","q10","q11","q12","q13"],"3":["q14","q15","q16"],"4":["q17","q18","q19"],"5":["q20","q21"],"6":["q22","q23","q24"],"7":["q25","q26"],"8":["q27","q28"]},
      balanced14: {"1":1,"2":2,"3":3,"4":3,"5":1,"6":2,"7":1,"8":1}
    },
    az104: {
      href: "az104.html",
      storage: { ui: "exam-ui-v2:microsoft-az-104", progress: "exam-progress:microsoft-az-104:v1" },
      all: qRange(256),
      // NOTE: grouped by ExamTopics topic, not yet by official domain (phase 2)
      domains: {"2":["q38","q39","q41","q42","q45","q48","q49","q52","q53","q54","q55","q56","q58","q61","q62","q63","q65","q66","q70","q71","q72","q76","q80","q82","q84"],"3":["q85","q86","q90","q91","q94","q95","q98","q99","q104","q105","q108","q113","q114"],"4":["q115","q117","q118","q119","q120","q121","q123","q125","q128","q129","q133","q134","q135","q136","q137","q138","q139","q143","q145","q147","q148","q149","q150","q153","q155","q156","q157","q158","q159"],"5":["q161","q162","q164","q165","q166","q168","q169","q170","q171","q172","q174","q176","q179","q180","q181","q182","q183","q185","q186","q189","q192","q194","q195","q197","q199","q201","q203","q204","q205","q206","q207","q208","q209","q210","q211","q213","q215","q216","q218","q219","q220","q221"],"6":["q222","q226","q227","q228","q230","q232","q234","q235","q236","q238","q239","q241","q242","q245","q246","q247","q249"]},
      quotas: {"40":{"2":10,"3":7,"4":10,"5":8,"6":5},"50":{"2":12,"3":10,"4":12,"5":9,"6":7},"60":{"2":15,"3":11,"4":15,"5":10,"6":9}}
    }
  };
})();
