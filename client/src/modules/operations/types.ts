export interface ConfigurationItem {
  id: string;
  tenantId: string;
  clientId: string | null;
  siteId: string | null;
  clientName?: string | null;
  siteName?: string | null;
  name: string;
  itemType: string;
  status: string;
  owner: string | null;
  vendor: string | null;
  product: string | null;
  model: string | null;
  serialNumber: string | null;
  ipAddress: string | null;
  macAddress: string | null;
  externalVaultReference: string | null;
  expirationDate: string | null;
  renewalDate: string | null;
  warrantyEndDate: string | null;
  details: Record<string, string | number | boolean | null>;
  tags: string[];
  notes: string | null;
  updatedAt: string | null;
  relationships?: Array<{
    id: string;
    sourceItemId: string;
    targetItemId: string;
    relationshipType: string;
    notes: string | null;
  }>;
  attachments?: Array<{
    attachment: { id: string; evidenceItemId: string; label: string | null };
    evidenceTitle: string;
    fileName: string;
  }>;
}

export interface DocumentationPage {
  id: string;
  clientId: string | null;
  siteId: string | null;
  folderId: string | null;
  clientName?: string | null;
  folderName?: string | null;
  pageType: string;
  title: string;
  slug: string;
  summary: string | null;
  content: string;
  status: string;
  category: string | null;
  minimumRole: string;
  tags: string[];
  version: number;
  updatedAt: string | null;
  revisions?: Array<{ id: string; version: number; changeNote: string | null; createdAt: string | null }>;
  backlinks?: Array<{ id: string; title: string; slug: string }>;
  attachments?: ConfigurationItem["attachments"];
}

export interface ContactRecord {
  id: string;
  clientId: string;
  siteId: string | null;
  clientName?: string | null;
  siteName?: string | null;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  contactType: string;
  notes: string | null;
}

export interface OpsSummary {
  totalItems: number;
  totalDocuments: number;
  totalContacts: number;
  dueItems: ConfigurationItem[];
  recentDocuments: DocumentationPage[];
  infrastructureByClient: Array<{ clientId: string | null; clientName: string | null; count: number }>;
}
