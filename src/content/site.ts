const configuredSiteUrl = import.meta.env.SITE?.trim() || "https://kubetee.ai";

export const site = {
  name: "KubeTEE",
  legalName: "KUBETEE AI LTD",
  title: "KubeTEE - The Confidential AI Factory on Bittensor SN90",
  description:
    "KubeTEE is Bittensor subnet 90 (SN90), a confidential AI factory running inference and AI workloads in Intel TDX and AMD SEV-SNP enclaves.",
  url: configuredSiteUrl.replace(/\/+$/, ""),
  themeColor: "#27282a",
  lastUpdated: "2026-11-04",
  links: {
    gateway: "https://llm.kubetee.ai",
    docs: "https://github.com/KubeTEE-AI/kubetee-subnet/blob/main/README.md",
    validator: "https://s3.hippius.com/kubetee-validator/index.html",
    saygm: "https://saygm.com/",
    github: "https://github.com/KubeTEE-AI",
    discord: "https://discord.gg/7SsA8Jw5J",
    x: "https://x.com/KubeTEEAI",
    dashboard: "/dashboard",
  },
} as const;

export const nav = [
  { label: "Overview", href: "/" },
  { label: "Dashboard", href: "/dashboard" },
  { label: "Docs", href: site.links.docs },
] as const;

export const sectionLinks = [
  { label: "What is KubeTEE", href: "#what" },
  { label: "How it's built", href: "#built" },
  { label: "How it works", href: "#how" },
  { label: "Live today", href: "#live" },
  { label: "Coming", href: "#coming" },
  { label: "FAQ", href: "#faq" },
] as const;

export const hero = {
  eyebrow: "Bittensor SN90 · Early Access",
  titleLines: [
    { text: "The Confidential", accent: false },
    { text: "AI Factory", accent: true },
    { text: "on Bittensor", accent: false },
  ],
  description:
    "KubeTEE is Bittensor subnet 90 (SN90): decentralized GPU clusters turned into a confidential factory for state-of-the-art AI services - inference and AI workloads running inside hardware-secured Trusted Execution Environments.",
  primaryCta: {
    label: "Open the Gateway",
    href: site.links.gateway,
  },
  secondaryCta: {
    label: "Read docs",
    href: site.links.docs,
  },
  specLine: "Intel TDX · AMD SEV-SNP · Kata + Confidential Containers",
  cube: {
    title: "A confidential guest inside a host, unlocked by KBS attestation",
    description:
      "A request enters the host from the left. The guest is isolated inside. A hardware quote travels to KBS, which releases a key. The response exits to the right.",
    caption: "Sealed data · Verified code · Secrets released only to the attested guest.",
  },
} as const;

export const what = {
  kicker: "What is KubeTEE",
  title: "An AI factory, run where the host can't read your data",
  intro:
    "KubeTEE is Bittensor subnet 90 (SN90). It turns decentralized GPU clusters into a confidential factory for state-of-the-art AI services. Data and models stay protected at rest, in transit, and in use.",
  assets: [
    {
      variant: "rest",
      label: "At rest",
      title: "Encrypted storage",
      caption: "Longhorn encrypted volumes with replicated data.",
      detail:
        "Encrypted Longhorn volumes are replicated across nodes, so data stays sealed on disk and in snapshots.",
    },
    {
      variant: "transit",
      label: "In transit",
      title: "Encrypted transport",
      caption: "TLS terminated inside the confidential guest.",
      detail:
        "TLS terminates inside the guest, so the host sees only ciphertext moving between clusters.",
    },
    {
      variant: "use",
      label: "In use",
      title: "Hardware-isolated TEE",
      caption: "The host cannot read workload memory.",
      detail:
        "Kata and Confidential Containers isolate the guest; the host cannot inspect memory or model weights.",
    },
  ],
} as const;

export const pillars = {
  kicker: "How it's built",
  title: "Four pillars",
  intro:
    "Four principles shape how KubeTEE turns decentralized GPU clusters into confidential AI infrastructure.",
  items: [
    {
      title: "Security-first TEE",
      body: "Hardware-isolated Trusted Execution Environments on a FIPS 140-2 validated Kubernetes baseline, with remote attestation so the exact code running on your data can be verified.",
    },
    {
      title: "Multi-cluster scheduling",
      body: "Rancher Fleet runs cluster operations today. Armada is planned for fair-use queuing, gang scheduling, and preemption across clusters.",
    },
    {
      title: "State-of-the-art AI services",
      body: "Confidential inference runs today through an OpenAI-compatible gateway. NVIDIA NeMo, NIM, and AI Blueprint integrations are partial or planned.",
    },
    {
      title: "Decentralized & open",
      body: "One identity per cluster, nodes in distinct US data centers, with international expansion planned. Built on open source; KubeTEE patches live in public forks.",
    },
  ],
} as const;

export const howItWorks = {
  kicker: "How it works",
  title: "From GPU cluster to attested inference.",
  intro:
    "Every request passes through a chain of hardware-backed trust. Each stage narrows access until only the attested workload can read your data.",
  stages: [
    {
      title: "GPU cluster",
      body: "Miner clusters run RKE2 with Rancher Fleet and the NVIDIA GPU Operator for high availability and consistent GPU provisioning.",
    },
    {
      title: "Confidential guest",
      body: "Kata Containers 4.2.0 and Confidential Containers isolate each workload on Intel TDX or AMD SEV-SNP.",
    },
    {
      title: "Remote attestation",
      body: "A nonce-bound hardware quote proves the guest measurement and configuration. CoCo Trustee and KBS release secrets only to an attested guest.",
    },
    {
      title: "Gateway",
      body: "LiteLLM runs inside a TDX guest and exposes an OpenAI-compatible API at llm.kubetee.ai.",
    },
    {
      title: "Your workload",
      body: "Send inference or AI requests through a standard API. The host cannot read your data or model weights.",
    },
  ],
  attestation: {
    title: "Attestation is part of the path, not a separate product.",
    linkLabel: "Read the attestation docs",
    href: site.links.docs,
  },
} as const;

export const live = {
  kicker: "Live today",
  title: "Running now, not a whitepaper",
  intro:
    "Confidential inference is live today in early access, backed by a live mainnet validator and TEE-capable infrastructure.",
  items: [
    {
      title: "Available through sayGM",
      body: "Confidential inference is available to buyers on sayGM, served inside TEE-isolated pods.",
      links: [
        { label: "saygm.com", href: site.links.saygm },
        { label: "Open the Gateway", href: site.links.gateway },
      ],
    },
    {
      title: "Paid external demand",
      body: "Alpha from paid inference on sayGM is swapped to SN90 and recycled on-chain.",
      links: [{ label: "View the recycle ledger", href: site.links.dashboard }],
    },
    {
      title: "Validator on Bittensor mainnet",
      body: "The validator is live on Finney. Its public dashboard shows the clusters it tracks, with infrastructure pricing and payouts.",
      links: [{ label: "Validator dashboard", href: site.links.validator }],
    },
    {
      title: "TEE-capable staging cluster",
      body: "Every node on the staging cluster is confidential-computing capable and runs the same TEE runtime classes as production miner clusters.",
      links: [{ label: "Read the cluster docs", href: site.links.docs }],
    },
  ],
} as const;

export const coming = {
  kicker: "Coming",
  title: "What we're building next",
  items: [
    {
      title: "Permissionless miner onboarding",
      body: "Miners register their own cluster and prove control of their hardware without operator involvement.",
    },
    {
      title: "Multi-cluster batch scheduling",
      body: "Armada dispatches fine-tuning, evaluation, and multi-step pipelines across decentralized clusters as confidential batch jobs.",
    },
    {
      title: "Agent- and chat-driven job deployment",
      body: "Deploy compute from an autonomous agent or a chat client - browse the catalogue, get a quote, submit, and track the job to completion.",
    },
    {
      title: "USDC and TAO billing",
      body: "Pay for confidential compute in stablecoins or TAO, alongside subnet-native Alpha.",
    },
  ],
} as const;

export const faq = {
  kicker: "FAQ",
  title: "Questions a technical buyer should ask.",
  items: [
    {
      question: "What is KubeTEE?",
      answer:
        "KubeTEE is Bittensor subnet 90, a confidential-compute network. It turns decentralized GPU clusters into a secure platform for inference and AI services, with confidential workloads running inside hardware TEEs.",
    },
    {
      question: "How is my data protected?",
      answer:
        "Workloads run inside hardware-isolated Trusted Execution Environments on Intel TDX or AMD SEV-SNP. The host cannot read workload memory, so data and models stay protected while they run.",
    },
    {
      question: "Can I verify what is running?",
      answer:
        "KubeTEE issues a nonce-bound hardware quote that proves the guest measurement and configuration. Secrets are released only to an attested guest.",
    },
    {
      question: "What can I run today?",
      answer:
        "Confidential inference through our OpenAI-compatible gateway and sayGM. Batch scheduling, agent workflows, and stablecoin billing are coming.",
    },
    {
      question: "Which GPUs do you support?",
      answer:
        "KubeTEE clusters use NVIDIA H100, H200, and B200 GPUs. Support is confirmed during onboarding.",
    },
    {
      question: "What does TEE overhead cost?",
      answer:
        "TEE overhead depends on the GPU, model, and workload; there is no single number. KubeTEE benchmarks your workload during onboarding and shares the results.",
    },
    {
      question: "How do I get started?",
      answer:
        "Open the gateway to try inference, read the docs for architecture and attestation details, or join the Discord to talk to the team.",
    },
  ],
} as const;

export const closing = {
  title: "Start with a confidential workload.",
  description: "Open the gateway, read the docs, or talk to the team about your workload.",
  primaryCta: {
    label: "Open the Gateway",
    href: site.links.gateway,
  },
  secondaryCta: {
    label: "Read docs",
    href: site.links.docs,
  },
} as const;

export const footer = {
  description:
    "Confidential compute for state-of-the-art AI services secured by TEE, incentivized by Bittensor.",
  links: [
    { label: "Dashboard", href: site.links.dashboard },
    { label: "Docs", href: site.links.docs },
    { label: "sayGM", href: site.links.saygm },
    { label: "Validator dashboard", href: site.links.validator },
    { label: "Gateway", href: site.links.gateway },
    { label: "GitHub", href: site.links.github },
    { label: "Discord", href: site.links.discord },
    { label: "X", href: site.links.x },
  ],
} as const;
