import { dashboard } from "../content/dashboard";
import { site } from "../content/site";
import { dashboardSummary } from "./dashboard";

const baseUrl = site.url;

const organizationId = `${baseUrl}/#organization`;
const websiteId = `${baseUrl}/#website`;
const serviceId = `${baseUrl}/#confidential-inference`;
const homeWebPageId = `${baseUrl}/#webpage`;
const dashboardWebPageId = `${baseUrl}/dashboard#webpage`;
const dashboardBreadcrumbId = `${baseUrl}/dashboard#breadcrumb`;
const dashboardDatasetId = `${baseUrl}/dashboard#dataset`;

const organization = {
  "@type": "Organization",
  "@id": organizationId,
  name: site.name,
  alternateName: ["KubeTEE AI"],
  legalName: site.legalName,
  url: baseUrl,
  description:
    "KubeTEE operates Bittensor subnet 90 (SN90), a confidential-compute network that runs AI inference and workloads inside hardware-secured Trusted Execution Environments.",
  logo: {
    "@type": "ImageObject",
    url: `${baseUrl}/brand/kubetee-icon.png`,
    width: 388,
    height: 354,
  },
  image: `${baseUrl}/logo.png`,
  sameAs: [site.links.github, site.links.x],
  knowsAbout: [
    "Bittensor subnet 90",
    "Confidential computing",
    "Trusted Execution Environments",
    "Intel TDX",
    "AMD SEV-SNP",
    "Confidential AI inference",
    "Remote attestation",
    "Kata Containers",
    "Confidential Containers",
  ],
  disambiguatingDescription:
    "KubeTEE AI operates Bittensor subnet 90 (SN90). It is not affiliated with the 2020 Ant Group / SOFAEnclave research project also named KubeTEE.",
};

const website = {
  "@type": "WebSite",
  "@id": websiteId,
  name: site.name,
  alternateName: "KubeTEE AI",
  url: baseUrl,
  description: site.description,
  inLanguage: "en",
  publisher: { "@id": organizationId },
};

const confidentialInferenceService = {
  "@type": "Service",
  "@id": serviceId,
  name: "Confidential AI inference",
  serviceType: "Confidential AI inference",
  description:
    "OpenAI-compatible inference running inside Intel TDX or AMD SEV-SNP Trusted Execution Environments, with remote attestation.",
  provider: { "@id": organizationId },
  availableChannel: {
    "@type": "ServiceChannel",
    serviceUrl: site.links.gateway,
  },
};

const homeWebPage = {
  "@type": "WebPage",
  "@id": homeWebPageId,
  url: `${baseUrl}/`,
  name: site.title,
  description: site.description,
  inLanguage: "en",
  isPartOf: { "@id": websiteId },
  about: { "@id": organizationId },
  mainEntity: { "@id": serviceId },
  dateModified: site.lastUpdated,
};

const dashboardWebPage = {
  "@type": "WebPage",
  "@id": dashboardWebPageId,
  url: `${baseUrl}/dashboard`,
  name: `${dashboard.meta.title} · ${site.name}`,
  description: dashboard.meta.description,
  inLanguage: "en",
  isPartOf: { "@id": websiteId },
  about: [{ "@id": organizationId }, { "@id": dashboardDatasetId }],
  mainEntity: { "@id": dashboardDatasetId },
  dateModified: dashboardSummary.generatedAt,
  breadcrumb: { "@id": dashboardBreadcrumbId },
};

const dashboardBreadcrumb = {
  "@type": "BreadcrumbList",
  "@id": dashboardBreadcrumbId,
  itemListElement: [
    {
      "@type": "ListItem",
      position: 1,
      name: "KubeTEE",
      item: `${baseUrl}/`,
    },
    {
      "@type": "ListItem",
      position: 2,
      name: "Recycle dashboard",
      item: `${baseUrl}/dashboard`,
    },
  ],
};

const rawJsonUrl = new URL(dashboard.links.rawJson, `${baseUrl}/`).toString();

const dashboardDataset = {
  "@type": "Dataset",
  "@id": dashboardDatasetId,
  name: "KubeTEE SN28 → SN90 Alpha Recycle Ledger",
  description:
    "Every SN28 → SN90 alpha recycle fill with its extrinsic, TAO value, and USD market estimate.",
  url: `${baseUrl}/dashboard`,
  creator: { "@id": organizationId },
  dateModified: dashboardSummary.generatedAt,
  ...(dashboardSummary.oldestFill ? { datePublished: dashboardSummary.oldestFill.ts } : {}),
  ...(dashboardSummary.oldestFill && dashboardSummary.latestFill
    ? {
        temporalCoverage: `${dashboardSummary.oldestFill.ts.slice(
          0,
          10,
        )}/${dashboardSummary.latestFill.ts.slice(0, 10)}`,
      }
    : {}),
  isAccessibleForFree: true,
  keywords: ["SN28", "SN90", "Bittensor", "alpha recycle", "TaoStats"],
  distribution: {
    "@type": "DataDownload",
    contentUrl: rawJsonUrl,
    encodingFormat: "application/json",
  },
  variableMeasured: [
    {
      "@type": "PropertyValue",
      name: "SN28 alpha swapped",
      unitText: "SN28 alpha",
    },
    {
      "@type": "PropertyValue",
      name: "SN90 alpha recycled",
      unitText: "SN90 alpha",
    },
    { "@type": "PropertyValue", name: "TAO swap value", unitText: "TAO" },
    {
      "@type": "PropertyValue",
      name: "USD market estimate",
      unitText: "USD",
    },
  ],
};

export const homeStructuredData = {
  "@context": "https://schema.org",
  "@graph": [organization, website, confidentialInferenceService, homeWebPage],
};

export const dashboardStructuredData = {
  "@context": "https://schema.org",
  "@graph": [organization, website, dashboardWebPage, dashboardBreadcrumb, dashboardDataset],
};
