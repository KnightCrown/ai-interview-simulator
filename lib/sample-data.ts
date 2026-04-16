import { JobRole, ResumeProfile } from "@/lib/interview-types";

export const JOB_ROLES: JobRole[] = [
  "Software Engineer",
  "Product Manager",
  "Data Analyst",
  "UX Designer",
  "Marketing Manager"
];

export const SAMPLE_RESUME: ResumeProfile = {
  name: "Alex Johnson",
  role: "Software Engineer",
  skills: ["JavaScript", "React", "Python"],
  experience: [
    "Frontend Intern at TechCorp",
    "Built dashboard that improved performance by 30%"
  ]
};

export const ROLE_EXPECTATIONS: Record<JobRole, string[]> = {
  "Software Engineer": [
    "system design tradeoffs",
    "debugging process",
    "code quality ownership",
    "impact with measurable outcomes"
  ],
  "Product Manager": [
    "customer empathy",
    "cross-functional leadership",
    "prioritization tradeoffs",
    "business impact"
  ],
  "Data Analyst": [
    "analytical rigor",
    "metrics fluency",
    "stakeholder communication",
    "data storytelling"
  ],
  "UX Designer": [
    "user research",
    "design rationale",
    "collaboration with engineers",
    "accessibility thinking"
  ],
  "Marketing Manager": [
    "campaign strategy",
    "audience segmentation",
    "channel experimentation",
    "revenue or funnel impact"
  ]
};
