import type { AssessmentProfile, AssessmentType } from "../schema";

/**
 * UCD Autumn 2026 seed data.
 *
 * Transcribed from the UCD public module descriptors as recorded in
 * SEMESTER_OS_CLAUDE_BUILD_BRIEF.md section 13, verified 25 Aug 2026.
 *
 * Treat this as a SOURCE FEED, not truth. UCD states curricular and
 * timetabling information may change, and once term starts Brightspace and
 * lecturer announcements supersede the generic descriptor. The importer must
 * diff and confirm rather than silently overwrite -- especially any field the
 * user has edited.
 */

export interface SeedAssessment {
  title: string;
  type: AssessmentType;
  weight: number;
  /** UCD publishes windows, not dates. Null for end-of-trimester exams. */
  dueWeek?: number | null;
  dueWeekEnd?: number | null;
  isExam?: boolean;
  examMinutes?: number;
}

export interface SeedModule {
  code: string;
  name: string;
  credits: number;
  coordinator: string;
  studentEffortHours: number;
  assessmentProfile: AssessmentProfile;
  attendanceMandatory?: boolean;
  colorToken: string;
  syllabusSummary: string;
  assessments: SeedAssessment[];
}

const ucdUrl = (code: string) =>
  `https://hub.ucd.ie/usis/!W_HU_MENU.P_PUBLISH?ACYR=2026&MODULE=${code}&TERMCODE=202600&p_tag=MODULE`;

export const moduleUrl = ucdUrl;

export const AUTUMN_2026_MODULES: SeedModule[] = [
  {
    code: "EEEN20020",
    name: "Electrical and Electronic Circuits",
    credits: 5,
    coordinator: "Professor Peter Kennedy",
    studentEffortHours: 120,
    // 65% final exam: weekly work looks fine until the exam says otherwise.
    assessmentProfile: "exam_heavy",
    colorToken: "amber",
    syllabusSummary:
      "Current, voltage and power; Kirchhoff laws; resistive circuits; node voltage analysis; controlled sources; op-amps; capacitors and inductors; transient response; phasors and sinusoidal steady state; frequency response; filters; diodes, rectifiers and transistors.",
    assessments: [
      { title: "Homework 1", type: "homework", weight: 5, dueWeek: 5 },
      { title: "Homework 2", type: "homework", weight: 5, dueWeek: 7 },
      { title: "Homework 3", type: "homework", weight: 5, dueWeek: 9 },
      { title: "Homework 4", type: "homework", weight: 5, dueWeek: 11 },
      {
        title: "Laboratory 1",
        type: "lab_report",
        weight: 5,
        dueWeek: 3,
        dueWeekEnd: 5,
      },
      {
        title: "Laboratory 2",
        type: "lab_report",
        weight: 5,
        dueWeek: 6,
        dueWeekEnd: 8,
      },
      {
        title: "Laboratory 3",
        type: "lab_report",
        weight: 5,
        dueWeek: 9,
        dueWeekEnd: 11,
      },
      {
        title: "Final Exam (open book)",
        type: "exam",
        weight: 65,
        dueWeek: null,
        isExam: true,
        examMinutes: 120,
      },
    ],
  },

  {
    code: "EEEN20050",
    name: "Digital Electronics: from gate to system",
    credits: 5,
    coordinator: "Dr Ruijia Liu",
    studentEffortHours: 120,
    // 60% is continuous (labs + projects) before the final.
    assessmentProfile: "continuous",
    colorToken: "emerald",
    syllabusSummary:
      "Binary systems; logic gates; Boolean algebra; Karnaugh maps; combinational circuits; arithmetic and control circuits; multiplexers and decoders; flip-flops; registers; counters; state machines; memory; configurable logic and FPGA; CMOS and logic-family implementation; timing.",
    assessments: [
      {
        title: "Home Assignment / Project 1",
        type: "project",
        weight: 15,
        dueWeek: 8,
      },
      {
        title: "Home Assignment / Project 2",
        type: "project",
        weight: 15,
        dueWeek: 12,
      },
      { title: "Mid-term Exam", type: "midterm", weight: 10, dueWeek: 6 },
      { title: "Lab Report 1", type: "lab_report", weight: 7.5, dueWeek: 4 },
      { title: "Lab Report 2", type: "lab_report", weight: 7.5, dueWeek: 6 },
      { title: "Lab Report 3", type: "lab_report", weight: 7.5, dueWeek: 8 },
      { title: "Lab Report 4", type: "lab_report", weight: 7.5, dueWeek: 10 },
      {
        title: "Final Exam",
        type: "exam",
        weight: 30,
        dueWeek: null,
        isExam: true,
        examMinutes: 120,
      },
    ],
  },

  {
    code: "EEEN20010",
    name: "Computer Engineering",
    credits: 5,
    coordinator: "Professor Mark Flanagan",
    studentEffortHours: 120,
    // No final exam in the current descriptor -- staying current with the
    // programming labs IS the grade.
    assessmentProfile: "continuous",
    colorToken: "sky",
    syllabusSummary:
      "C programming; types, operators and expressions; I/O; control flow; functions; preprocessor; arrays, pointers and strings; structs and user-defined types; files; multi-file program organisation; linked lists; stacks; sorting; algorithm analysis.",
    assessments: [
      {
        title: "Lab Programming Assignments",
        type: "project",
        weight: 40,
        dueWeek: 2,
        dueWeekEnd: 11,
      },
      {
        title: "In-class Brightspace Quiz 1",
        type: "quiz",
        weight: 30,
        dueWeek: 8,
      },
      {
        title: "In-class Brightspace Quiz 2",
        type: "quiz",
        weight: 30,
        dueWeek: 12,
      },
    ],
  },

  {
    code: "EEEN20070",
    name: "Solid State Devices",
    credits: 5,
    coordinator: "Dr Xu Wang",
    studentEffortHours: 108,
    // 60% final + 20% midterm: revision debt matters more than task counts.
    assessmentProfile: "exam_heavy",
    colorToken: "rose",
    syllabusSummary:
      "Introductory quantum mechanics; band theory; metals, insulators and semiconductors; charge transport; doping; continuity and Poisson equations; semiconductor processing; PN junction; MOS capacitor and MOSFET; BJT.",
    assessments: [
      {
        title: "Final Exam (closed book)",
        type: "exam",
        weight: 60,
        dueWeek: null,
        isExam: true,
        examMinutes: 120,
      },
      {
        title: "Mid-term Exam (closed book)",
        type: "midterm",
        weight: 20,
        dueWeek: 7,
        dueWeekEnd: 9,
      },
      {
        title: "Lab Assignment 1 Report",
        type: "lab_report",
        weight: 10,
        dueWeek: 9,
      },
      {
        title: "Lab Assignment 2 Report",
        type: "lab_report",
        weight: 10,
        dueWeek: 11,
      },
    ],
  },

  {
    code: "MATH20290",
    name: "Multivariable Calculus for Engineers",
    credits: 5,
    coordinator: "Assoc Professor Thomas Unger",
    studentEffortHours: 100,
    // 85% on one exam. The highest-risk module in the trimester by far.
    assessmentProfile: "exam_heavy",
    colorToken: "violet",
    syllabusSummary:
      "Functions of several variables; partial derivatives; multivariable chain rule; linear approximation; gradient and directional derivative; Hessian; Jacobian; critical points; constrained optimisation; Lagrange multipliers; higher-order linear ODEs; Laplace transform if time permits.",
    assessments: [
      { title: "Online Midterm", type: "midterm", weight: 15, dueWeek: 7 },
      {
        title: "Final Exam",
        type: "exam",
        weight: 85,
        dueWeek: null,
        isExam: true,
        examMinutes: 120,
      },
    ],
  },

  {
    code: "SCI20020",
    name: "Introduction to Leadership",
    credits: 5,
    coordinator: "",
    studentEffortHours: 110,
    // 100% portfolio, and attendance is mandatory.
    assessmentProfile: "portfolio",
    attendanceMandatory: true,
    colorToken: "teal",
    syllabusSummary:
      "Practical leadership; project management; time management; negotiation; cognitive bias; decision-making; communication; Gantt charts; career planning; working with difficult people. Lecture attendance is stated as mandatory.",
    assessments: [
      {
        title:
          "Portfolio (reflective writing, group-discussion and case-study commentary)",
        type: "portfolio",
        weight: 100,
        dueWeek: 12,
      },
    ],
  },
];

export const SEED_AREAS = [
  {
    id: "university",
    name: "University",
    isUniversity: true,
    colorToken: "sky",
    sortOrder: 0,
  },
  {
    id: "gaelforce",
    name: "GaelForce",
    isUniversity: false,
    colorToken: "amber",
    sortOrder: 1,
  },
  {
    id: "accio",
    name: "Accio",
    isUniversity: false,
    colorToken: "violet",
    sortOrder: 2,
  },
  {
    id: "personal",
    name: "Personal",
    isUniversity: false,
    colorToken: "neutral",
    sortOrder: 3,
  },
];

/** UCD's own stated effort across all six modules, in hours. */
export const TOTAL_STATED_EFFORT_HOURS = AUTUMN_2026_MODULES.reduce(
  (sum, m) => sum + m.studentEffortHours,
  0,
);
