import { useQuery } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import {
  Users,
  FileText,
  Server,
  MapPin,
  Mail,
  Phone,
  Building2,
  Clock,
  Network,
  BookOpen,
  ContactRound,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { formatDistanceToNow } from "date-fns";
import type { Client, Site, Asset, EvidenceItem } from "@shared/schema";
import type { ConfigurationItem, ContactRecord, DocumentationPage } from "@/modules/operations/types";

interface ClientDetail extends Client {
  sites: Site[];
  assets: Asset[];
  evidenceItems: EvidenceItem[];
}

export default function ClientDetailPage() {
  const [, params] = useRoute("/clients/:id");

  const { data: client, isLoading } = useQuery<ClientDetail>({
    queryKey: ["/api/clients", params?.id],
    enabled: !!params?.id,
  });
  const { data: configurationItems = [] } = useQuery<ConfigurationItem[]>({
    queryKey: [`/api/ops/items?clientId=${params?.id || ""}`],
    enabled: !!params?.id,
  });
  const { data: documents = [] } = useQuery<DocumentationPage[]>({
    queryKey: [`/api/ops/documents?clientId=${params?.id || ""}`],
    enabled: !!params?.id,
  });
  const { data: contacts = [] } = useQuery<ContactRecord[]>({
    queryKey: [`/api/ops/contacts?clientId=${params?.id || ""}`],
    enabled: !!params?.id,
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  if (!client) {
    return (
      <div className="p-6 text-center">
        <p className="text-muted-foreground">Client not found.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <Breadcrumbs items={[
        { label: "Clients", href: "/clients" },
        { label: client.name },
      ]} />

      <div className="flex items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-client-name">
            {client.name}
          </h1>
          <div className="flex items-center gap-3 text-sm text-muted-foreground mt-0.5 flex-wrap">
            {client.company && (
              <span className="flex items-center gap-1">
                <Building2 className="w-3 h-3" />
                {client.company}
              </span>
            )}
            {client.email && (
              <span className="flex items-center gap-1">
                <Mail className="w-3 h-3" />
                {client.email}
              </span>
            )}
            {client.phone && (
              <span className="flex items-center gap-1">
                <Phone className="w-3 h-3" />
                {client.phone}
              </span>
            )}
          </div>
        </div>
      </div>

      {client.notes && (
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">{client.notes}</p>
          </CardContent>
        </Card>
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-md bg-primary/10 flex items-center justify-center">
              <MapPin className="w-4 h-4 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{client.sites?.length || 0}</p>
              <p className="text-xs text-muted-foreground">Sites</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-md bg-primary/10 flex items-center justify-center">
              <Server className="w-4 h-4 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{client.assets?.length || 0}</p>
              <p className="text-xs text-muted-foreground">Assets</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-md bg-primary/10 flex items-center justify-center">
              <FileText className="w-4 h-4 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">
                {client.evidenceItems?.length || 0}
              </p>
              <p className="text-xs text-muted-foreground">Evidence</p>
            </div>
          </CardContent>
        </Card>
        <Link href="/inventory">
          <Card className="h-full hover-elevate cursor-pointer"><CardContent className="p-4 flex items-center gap-3"><div className="w-9 h-9 rounded-md bg-primary/10 flex items-center justify-center"><Network className="w-4 h-4 text-primary" /></div><div><p className="text-2xl font-bold">{configurationItems.length}</p><p className="text-xs text-muted-foreground">Infrastructure</p></div></CardContent></Card>
        </Link>
        <Link href="/documentation">
          <Card className="h-full hover-elevate cursor-pointer"><CardContent className="p-4 flex items-center gap-3"><div className="w-9 h-9 rounded-md bg-primary/10 flex items-center justify-center"><BookOpen className="w-4 h-4 text-primary" /></div><div><p className="text-2xl font-bold">{documents.length}</p><p className="text-xs text-muted-foreground">Documents</p></div></CardContent></Card>
        </Link>
        <Card><CardContent className="p-4 flex items-center gap-3"><div className="w-9 h-9 rounded-md bg-primary/10 flex items-center justify-center"><ContactRound className="w-4 h-4 text-primary" /></div><div><p className="text-2xl font-bold">{contacts.length}</p><p className="text-xs text-muted-foreground">Contacts</p></div></CardContent></Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader className="pb-3"><CardTitle className="text-base font-semibold">Infrastructure snapshot</CardTitle></CardHeader><CardContent>{configurationItems.length ? <div className="space-y-2">{configurationItems.slice(0, 6).map((item) => <Link key={item.id} href="/inventory"><div className="flex items-center justify-between rounded-md border p-3 hover:bg-muted"><div><p className="text-sm font-medium">{item.name}</p><p className="text-xs text-muted-foreground">{item.itemType.replaceAll("_", " ")} · {item.siteName || "No site"}</p></div><Badge variant="outline">{item.status}</Badge></div></Link>)}</div> : <p className="py-6 text-center text-sm text-muted-foreground">No infrastructure records are linked to this client.</p>}</CardContent></Card>
        <Card><CardHeader className="pb-3"><CardTitle className="text-base font-semibold">Documentation</CardTitle></CardHeader><CardContent>{documents.length ? <div className="space-y-2">{documents.slice(0, 6).map((document) => <Link key={document.id} href="/documentation"><div className="flex items-center justify-between rounded-md border p-3 hover:bg-muted"><div><p className="text-sm font-medium">{document.title}</p><p className="text-xs text-muted-foreground">{document.pageType.replaceAll("_", " ")} · v{document.version}</p></div><Badge variant={document.status === "published" ? "default" : "secondary"}>{document.status}</Badge></div></Link>)}</div> : <p className="py-6 text-center text-sm text-muted-foreground">No runbooks or documentation are linked to this client.</p>}</CardContent></Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Evidence Items</CardTitle>
        </CardHeader>
        <CardContent>
          {!client.evidenceItems?.length ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              No evidence linked to this client yet.
            </p>
          ) : (
            <div className="space-y-2">
              {client.evidenceItems.map((item) => (
                <Link key={item.id} href={`/evidence/${item.id}`}>
                  <div className="flex items-center justify-between gap-3 p-3 rounded-md hover-elevate cursor-pointer">
                    <div className="flex items-center gap-3 min-w-0">
                      <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{item.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.fileName}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground flex-shrink-0">
                      <Clock className="w-3 h-3" />
                      {item.createdAt
                        ? formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })
                        : "Just now"}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
