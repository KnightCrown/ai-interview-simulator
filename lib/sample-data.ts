import { JobRole, ResumeProfile } from "@/lib/interview-types";

export const JOB_ROLES = [
  "Software Engineer",
  "Frontend Engineer",
  "Backend Engineer",
  "Full Stack Engineer",
  "Mobile App Developer",
  "DevOps Engineer",
  "Cloud Engineer",
  "Machine Learning Engineer",
  "Data Engineer",
  "Cybersecurity Analyst",
  "IT Support Specialist",
  "Systems Administrator",
  "Network Administrator",
  "Database Administrator",
  "QA Engineer",
  "Technical Support Engineer",
  "Solutions Architect",
  "Business Analyst",
  "Product Manager",
  "Data Analyst",
  "UX Designer",
  "Marketing Manager",
  "Project Manager",
  "Sales Representative",
  "Customer Success Manager",
  "Human Resources Coordinator",
  "Financial Analyst",
  "Operations Manager",
  "Other"
] satisfies JobRole[];

export const SAMPLE_RESUME: ResumeProfile = {
  name: "Alex Johnson",
  role: "Software Engineer",
  skills: ["JavaScript", "React", "Python"],
  experience: [
    "Frontend Intern at TechCorp",
    "Built dashboard that improved performance by 30%"
  ]
};

const DEFAULT_ROLE_EXPECTATIONS = [
  "clear ownership",
  "role-specific examples",
  "collaboration",
  "measurable impact"
];

export const ROLE_EXPECTATIONS: Record<string, string[]> = {
  "Software Engineer": [
    "system design tradeoffs",
    "debugging process",
    "code quality ownership",
    "impact with measurable outcomes"
  ],
  "Frontend Engineer": [
    "user interface architecture",
    "performance optimization",
    "accessibility",
    "collaboration with design and backend teams"
  ],
  "Backend Engineer": [
    "API design",
    "database modeling",
    "reliability",
    "system performance tradeoffs"
  ],
  "Full Stack Engineer": [
    "end-to-end feature ownership",
    "frontend and backend integration",
    "debugging across the stack",
    "product impact"
  ],
  "Mobile App Developer": [
    "mobile platform constraints",
    "app performance",
    "release quality",
    "user experience"
  ],
  "DevOps Engineer": [
    "CI/CD ownership",
    "infrastructure automation",
    "incident response",
    "observability"
  ],
  "Cloud Engineer": [
    "cloud architecture",
    "cost and reliability tradeoffs",
    "security controls",
    "automation"
  ],
  "Machine Learning Engineer": [
    "model evaluation",
    "data quality",
    "production deployment",
    "monitoring and drift"
  ],
  "Data Engineer": [
    "data pipeline reliability",
    "ETL design",
    "data quality",
    "scalable processing"
  ],
  "Cybersecurity Analyst": [
    "threat detection",
    "incident triage",
    "risk assessment",
    "security tooling"
  ],
  "IT Support Specialist": [
    "troubleshooting process",
    "customer communication",
    "ticket prioritization",
    "technical documentation"
  ],
  "Systems Administrator": [
    "server administration",
    "access management",
    "backup and recovery",
    "system monitoring"
  ],
  "Network Administrator": [
    "network troubleshooting",
    "routing and switching",
    "security configuration",
    "uptime management"
  ],
  "Database Administrator": [
    "database performance",
    "backup strategy",
    "data integrity",
    "access controls"
  ],
  "QA Engineer": [
    "test planning",
    "bug isolation",
    "automation strategy",
    "release risk"
  ],
  "Technical Support Engineer": [
    "technical troubleshooting",
    "customer empathy",
    "root cause analysis",
    "escalation judgment"
  ],
  "Solutions Architect": [
    "customer requirements",
    "technical architecture",
    "tradeoff communication",
    "implementation feasibility"
  ],
  "Business Analyst": [
    "requirements gathering",
    "stakeholder alignment",
    "process improvement",
    "data-informed recommendations"
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
  ],
  "Project Manager": [
    "scope management",
    "stakeholder communication",
    "risk mitigation",
    "delivery discipline"
  ],
  "Sales Representative": [
    "prospecting",
    "discovery questions",
    "objection handling",
    "pipeline discipline"
  ],
  "Customer Success Manager": [
    "customer retention",
    "account planning",
    "product adoption",
    "relationship management"
  ],
  "Human Resources Coordinator": [
    "candidate experience",
    "process coordination",
    "confidentiality",
    "employee support"
  ],
  "Financial Analyst": [
    "financial modeling",
    "variance analysis",
    "business recommendations",
    "attention to detail"
  ],
  "Operations Manager": [
    "process improvement",
    "team coordination",
    "operational metrics",
    "execution under constraints"
  ]
};

export function getRoleExpectations(role: JobRole) {
  return ROLE_EXPECTATIONS[role] ?? DEFAULT_ROLE_EXPECTATIONS;
}
