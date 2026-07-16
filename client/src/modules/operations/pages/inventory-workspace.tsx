import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowRightLeft, Cable, CalendarClock, CheckCircle2, Database,
  FileUp, Filter, KeyRound, Link2, Network, Plus, Search, Server, ShieldCheck,
  Trash2, UserRound, Users, X,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { Client, EvidenceItem, Site } from "@shared/schema";
import type { ConfigurationItem, ContactRecord, OpsSummary } from "../types";

export type InventoryMode = "inventory" | "network" | "lifecycle";

const allTypes = [
  "server", "workstation", "network_device", "firewall", "switch", "access_point", "printer",
  "application", "domain", "dns_record", "dhcp_scope", "vlan", "subnet", "ip_address", "public_ip",
  "isp", "circuit", "vendor", "license", "certificate", "warranty", "configuration_item",
  "port_mapping", "credential_reference",
];
const networkTypes = ["network_device", "firewall", "switch", "access_point", "domain", "dns_record", "dhcp_scope", "vlan", "subnet", "ip_address", "public_ip", "isp", "circuit", "port_mapping"];
const lifecycleTypes = ["license", "certificate", "warranty"];

const modeConfig = {
  inventory: { title: "Infrastructure inventory", subtitle: "Systems, applications, vendors, ownership, evidence, and dependency mapping.", icon: Server, types: allTypes },
  network: { title: "Network documentation", subtitle: "WAN, routing, switching, wireless, addressing, DNS, DHCP, and port relationships.", icon: Network, types: networkTypes },
  lifecycle: { title: "Lifecycle control", subtitle: "Licenses, certificates, warranties, renewals, and assigned system coverage.", icon: CalendarClock, types: lifecycleTypes },
};

const emptyItem = {
  name: "", itemType: "server", status: "active", clientId: "none", siteId: "none", owner: "",
  vendor: "", product: "", model: "", serialNumber: "", ipAddress: "", macAddress: "",
  externalVaultReference: "", expirationDate: "", renewalDate: "", warrantyEndDate: "",
  tags: "", details: "", notes: "",
};

function pretty(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function nullable(value: string) {
  return value.trim() || null;
}

function isoDate(value: string) {
  return value ? new Date(`${value}T00:00:00.000Z`).toISOString() : null;
}

function parseDetails(value: string) {
  return Object.fromEntries(value.split("\n").map((line) => line.split("=")).filter((parts) => parts.length >= 2 && parts[0].trim()).map(([key, ...rest]) => [key.trim(), rest.join("=").trim()]));
}

function dueDate(item: ConfigurationItem) {
  return item.expirationDate || item.renewalDate || item.warrantyEndDate;
}

export default function InventoryWorkspace({ mode = "inventory" }: { mode?: InventoryMode }) {
  const config = modeConfig[mode];
  const Icon = config.icon;
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...emptyItem, itemType: config.types[0] });
  const [relationshipTarget, setRelationshipTarget] = useState("");
  const [relationshipType, setRelationshipType] = useState("depends_on");
  const [selectedEvidence, setSelectedEvidence] = useState("");
  const [contactOpen, setContactOpen] = useState(false);
  const [contact, setContact] = useState({ clientId: "", siteId: "none", name: "", title: "", email: "", phone: "", contactType: "technical", notes: "" });
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<any>(null);

  const params = new URLSearchParams();
  if (mode !== "inventory") params.set("group", mode);
  if (query) params.set("q", query);
  if (typeFilter !== "all") params.set("itemType", typeFilter);
  const itemUrl = `/api/ops/items?${params.toString()}`;

  const { data: items = [], isLoading } = useQuery<ConfigurationItem[]>({ queryKey: [itemUrl] });
  const { data: selected } = useQuery<ConfigurationItem>({ queryKey: ["/api/ops/items", selectedId], enabled: Boolean(selectedId) });
  const { data: clients = [] } = useQuery<Client[]>({ queryKey: ["/api/clients"] });
  const { data: sites = [] } = useQuery<Site[]>({ queryKey: ["/api/sites"] });
  const { data: contacts = [] } = useQuery<ContactRecord[]>({ queryKey: ["/api/ops/contacts"] });
  const { data: evidence = [] } = useQuery<EvidenceItem[]>({ queryKey: ["/api/evidence"] });
  const { data: summary } = useQuery<OpsSummary>({ queryKey: ["/api/ops/summary"] });

  const visibleSites = useMemo(() => sites.filter((site) => form.clientId === "none" || site.clientId === form.clientId), [sites, form.clientId]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: [itemUrl] });
    queryClient.invalidateQueries({ queryKey: ["/api/ops/items"] });
    queryClient.invalidateQueries({ queryKey: ["/api/ops/summary"] });
  };

  const createItem = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/ops/items", {
        ...form,
        clientId: form.clientId === "none" ? null : form.clientId,
        siteId: form.siteId === "none" ? null : form.siteId,
        owner: nullable(form.owner), vendor: nullable(form.vendor), product: nullable(form.product), model: nullable(form.model),
        serialNumber: nullable(form.serialNumber), ipAddress: nullable(form.ipAddress), macAddress: nullable(form.macAddress),
        externalVaultReference: nullable(form.externalVaultReference), expirationDate: isoDate(form.expirationDate),
        renewalDate: isoDate(form.renewalDate), warrantyEndDate: isoDate(form.warrantyEndDate),
        tags: form.tags.split(",").map((tag) => tag.trim()).filter(Boolean), details: parseDetails(form.details), notes: nullable(form.notes),
      });
      return response.json();
    },
    onSuccess: (item: ConfigurationItem) => {
      setCreateOpen(false); setForm({ ...emptyItem, itemType: config.types[0] }); setSelectedId(item.id); refresh();
      toast({ title: "Configuration item created", description: `${item.name} is now part of the tenant inventory.` });
    },
    onError: (error: Error) => toast({ title: "Could not create item", description: error.message, variant: "destructive" }),
  });

  const deleteItem = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/ops/items/${id}`),
    onSuccess: () => { setSelectedId(null); refresh(); toast({ title: "Configuration item deleted" }); },
    onError: (error: Error) => toast({ title: "Delete failed", description: error.message, variant: "destructive" }),
  });

  const createRelationship = useMutation({
    mutationFn: () => apiRequest("POST", "/api/ops/relationships", { sourceItemId: selectedId, targetItemId: relationshipTarget, relationshipType, notes: null }),
    onSuccess: () => { setRelationshipTarget(""); queryClient.invalidateQueries({ queryKey: ["/api/ops/items", selectedId] }); toast({ title: "Relationship mapped" }); },
    onError: (error: Error) => toast({ title: "Could not map relationship", description: error.message, variant: "destructive" }),
  });

  const linkEvidence = useMutation({
    mutationFn: () => apiRequest("POST", "/api/ops/attachments", { evidenceItemId: selectedEvidence, configurationItemId: selectedId, documentationPageId: null, label: null }),
    onSuccess: () => { setSelectedEvidence(""); queryClient.invalidateQueries({ queryKey: ["/api/ops/items", selectedId] }); toast({ title: "Evidence attached" }); },
    onError: (error: Error) => toast({ title: "Attachment failed", description: error.message, variant: "destructive" }),
  });

  const createContact = useMutation({
    mutationFn: () => apiRequest("POST", "/api/ops/contacts", { ...contact, siteId: contact.siteId === "none" ? null : contact.siteId, title: nullable(contact.title), email: nullable(contact.email), phone: nullable(contact.phone), notes: nullable(contact.notes) }),
    onSuccess: () => { setContactOpen(false); setContact({ clientId: "", siteId: "none", name: "", title: "", email: "", phone: "", contactType: "technical", notes: "" }); queryClient.invalidateQueries({ queryKey: ["/api/ops/contacts"] }); toast({ title: "Contact added" }); },
    onError: (error: Error) => toast({ title: "Could not add contact", description: error.message, variant: "destructive" }),
  });

  const previewImport = async () => {
    try {
      const response = await apiRequest("POST", "/api/ops/import/preview", { kind: mode === "network" ? "ip_records" : "items", csv });
      setPreview(await response.json());
    } catch (error: any) { toast({ title: "Preview failed", description: error.message, variant: "destructive" }); }
  };
  const commitImport = async () => {
    try {
      const rows = preview.rows.filter((row: any) => !row.errors.length && !row.duplicate).map((row: any) => row.data);
      const response = await apiRequest("POST", "/api/ops/import/commit", { kind: mode === "network" ? "ip_records" : "items", rows });
      const result = await response.json(); setPreview(null); setCsv(""); refresh();
      toast({ title: `${result.imported} rows imported`, description: result.errors.length ? `${result.errors.length} rows need attention.` : "All records were created." });
    } catch (error: any) { toast({ title: "Import failed", description: error.message, variant: "destructive" }); }
  };

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-[1500px] mx-auto">
      <section className="relative overflow-hidden rounded-xl border bg-card p-5 md:p-7">
        <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_82%_20%,hsl(var(--primary)/0.14),transparent_35%)]" />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary"><Icon className="h-4 w-4" /> TechDeck operations graph</div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">{config.title}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{config.subtitle}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />New record</Button></DialogTrigger>
              <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                <DialogHeader><DialogTitle>Create configuration record</DialogTitle><DialogDescription>Store operational metadata only. Passwords, tokens, and private keys must remain in an external vault.</DialogDescription></DialogHeader>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Name"><Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
                  <Field label="Type"><Select value={form.itemType} onValueChange={(value) => setForm({ ...form, itemType: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{config.types.map((type) => <SelectItem key={type} value={type}>{pretty(type)}</SelectItem>)}</SelectContent></Select></Field>
                  <Field label="Client"><Select value={form.clientId} onValueChange={(value) => setForm({ ...form, clientId: value, siteId: "none" })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Shared / unassigned</SelectItem>{clients.map((client) => <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>)}</SelectContent></Select></Field>
                  <Field label="Site"><Select value={form.siteId} onValueChange={(value) => setForm({ ...form, siteId: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">No site</SelectItem>{visibleSites.map((site) => <SelectItem key={site.id} value={site.id}>{site.name}</SelectItem>)}</SelectContent></Select></Field>
                  <Field label="Status"><Select value={form.status} onValueChange={(value) => setForm({ ...form, status: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["active", "inactive", "planned", "retired", "warning", "expired"].map((value) => <SelectItem key={value} value={value}>{pretty(value)}</SelectItem>)}</SelectContent></Select></Field>
                  <Field label="Owner"><Input value={form.owner} onChange={(event) => setForm({ ...form, owner: event.target.value })} /></Field>
                  <Field label="Vendor"><Input value={form.vendor} onChange={(event) => setForm({ ...form, vendor: event.target.value })} /></Field>
                  <Field label="Product"><Input value={form.product} onChange={(event) => setForm({ ...form, product: event.target.value })} /></Field>
                  <Field label="Model"><Input value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })} /></Field>
                  <Field label="Serial / identifier"><Input value={form.serialNumber} onChange={(event) => setForm({ ...form, serialNumber: event.target.value })} /></Field>
                  <Field label="IP address"><Input value={form.ipAddress} onChange={(event) => setForm({ ...form, ipAddress: event.target.value })} /></Field>
                  <Field label="MAC address"><Input value={form.macAddress} onChange={(event) => setForm({ ...form, macAddress: event.target.value })} /></Field>
                  <Field label="Expiration"><Input type="date" value={form.expirationDate} onChange={(event) => setForm({ ...form, expirationDate: event.target.value })} /></Field>
                  <Field label="Renewal"><Input type="date" value={form.renewalDate} onChange={(event) => setForm({ ...form, renewalDate: event.target.value })} /></Field>
                  <Field label="Warranty end"><Input type="date" value={form.warrantyEndDate} onChange={(event) => setForm({ ...form, warrantyEndDate: event.target.value })} /></Field>
                  <Field label="Tags (comma separated)"><Input value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} /></Field>
                  <div className="sm:col-span-2"><Field label="External vault reference"><Input value={form.externalVaultReference} placeholder="1Password/Bitwarden/Azure Key Vault item URL or ID" onChange={(event) => setForm({ ...form, externalVaultReference: event.target.value })} /></Field></div>
                  <div className="sm:col-span-2"><Field label="Technical details (one key=value per line)"><Textarea value={form.details} placeholder="gateway=10.20.0.1\nvlan_id=20\nsubnet=10.20.0.0/24" onChange={(event) => setForm({ ...form, details: event.target.value })} /></Field></div>
                  <div className="sm:col-span-2"><Field label="Notes"><Textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></Field></div>
                </div>
                <DialogFooter><Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button><Button disabled={!form.name || createItem.isPending} onClick={() => createItem.mutate()}>{createItem.isPending ? "Creating…" : "Create record"}</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-3">
        <Metric icon={Database} label="Configuration records" value={summary?.totalItems ?? 0} />
        <Metric icon={CalendarClock} label="Due within 90 days" value={summary?.dueItems.length ?? 0} warning={Boolean(summary?.dueItems.length)} />
        <Metric icon={Link2} label="Mapped in this view" value={items.length} />
      </div>

      <Tabs defaultValue="records">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <TabsList>
            <TabsTrigger value="records">Records</TabsTrigger>
            {mode === "inventory" && <TabsTrigger value="contacts">Contacts</TabsTrigger>}
            <TabsTrigger value="import">Import</TabsTrigger>
          </TabsList>
          <div className="flex gap-2">
            <div className="relative flex-1 md:w-80"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pl-9" placeholder="Search names, IPs, serials, notes…" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
            <Select value={typeFilter} onValueChange={setTypeFilter}><SelectTrigger className="w-44"><Filter className="h-4 w-4 mr-2" /><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All record types</SelectItem>{config.types.map((type) => <SelectItem key={type} value={type}>{pretty(type)}</SelectItem>)}</SelectContent></Select>
          </div>
        </div>

        <TabsContent value="records" className="mt-4">
          <Card><CardContent className="p-0 overflow-x-auto">
            <Table><TableHeader><TableRow><TableHead>Record</TableHead><TableHead>Type</TableHead><TableHead>Client / Site</TableHead><TableHead>Address / Identifier</TableHead><TableHead>Status</TableHead>{mode === "lifecycle" && <TableHead>Due</TableHead>}</TableRow></TableHeader>
              <TableBody>{isLoading ? <TableRow><TableCell colSpan={6} className="py-12 text-center text-muted-foreground">Loading inventory…</TableCell></TableRow> : items.length === 0 ? <TableRow><TableCell colSpan={6} className="py-12 text-center"><Database className="mx-auto h-8 w-8 text-muted-foreground/50" /><p className="mt-3 font-medium">No matching configuration records</p><p className="text-sm text-muted-foreground">Create a record or import validated CSV data.</p></TableCell></TableRow> : items.map((item) => (
                <TableRow key={item.id} className="cursor-pointer" onClick={() => setSelectedId(item.id)}>
                  <TableCell><div className="font-medium">{item.name}</div><div className="text-xs text-muted-foreground">{item.vendor} {item.model}</div></TableCell>
                  <TableCell><Badge variant="outline">{pretty(item.itemType)}</Badge></TableCell>
                  <TableCell><div>{item.clientName || "Shared"}</div><div className="text-xs text-muted-foreground">{item.siteName || "No site"}</div></TableCell>
                  <TableCell className="font-mono text-xs">{item.ipAddress || item.serialNumber || "—"}</TableCell>
                  <TableCell><StatusBadge status={item.status} /></TableCell>
                  {mode === "lifecycle" && <TableCell>{dueDate(item) ? new Date(dueDate(item)!).toLocaleDateString() : "—"}</TableCell>}
                </TableRow>
              ))}</TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        {mode === "inventory" && <TabsContent value="contacts" className="mt-4 space-y-3">
          <div className="flex justify-end"><Dialog open={contactOpen} onOpenChange={setContactOpen}><DialogTrigger asChild><Button><UserRound className="h-4 w-4 mr-2" />Add contact</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>Add client contact</DialogTitle><DialogDescription>Contacts remain tenant-scoped and associated to a client.</DialogDescription></DialogHeader><div className="space-y-4">
            <Field label="Client"><Select value={contact.clientId} onValueChange={(value) => setContact({ ...contact, clientId: value, siteId: "none" })}><SelectTrigger><SelectValue placeholder="Choose client" /></SelectTrigger><SelectContent>{clients.map((client) => <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>)}</SelectContent></Select></Field>
            <Field label="Name"><Input value={contact.name} onChange={(event) => setContact({ ...contact, name: event.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3"><Field label="Title"><Input value={contact.title} onChange={(event) => setContact({ ...contact, title: event.target.value })} /></Field><Field label="Type"><Select value={contact.contactType} onValueChange={(value) => setContact({ ...contact, contactType: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["primary", "technical", "billing", "emergency", "vendor"].map((type) => <SelectItem key={type} value={type}>{pretty(type)}</SelectItem>)}</SelectContent></Select></Field></div>
            <Field label="Email"><Input type="email" value={contact.email} onChange={(event) => setContact({ ...contact, email: event.target.value })} /></Field><Field label="Phone"><Input value={contact.phone} onChange={(event) => setContact({ ...contact, phone: event.target.value })} /></Field>
          </div><DialogFooter><Button disabled={!contact.clientId || !contact.name || createContact.isPending} onClick={() => createContact.mutate()}>Add contact</Button></DialogFooter></DialogContent></Dialog></div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{contacts.map((record) => <Card key={record.id}><CardContent className="p-4"><div className="flex items-start justify-between"><div><p className="font-semibold">{record.name}</p><p className="text-xs text-muted-foreground">{record.title || pretty(record.contactType)}</p></div><Badge variant="outline">{pretty(record.contactType)}</Badge></div><div className="mt-4 space-y-1 text-sm"><p>{record.clientName}</p><p className="text-muted-foreground">{record.email || "No email"}</p><p className="text-muted-foreground">{record.phone || "No phone"}</p></div></CardContent></Card>)}</div>
        </TabsContent>}

        <TabsContent value="import" className="mt-4"><Card><CardHeader><CardTitle className="text-base flex items-center gap-2"><FileUp className="h-4 w-4" />Validated CSV import</CardTitle></CardHeader><CardContent className="space-y-4"><p className="text-sm text-muted-foreground">Required columns: <code>name,item_type</code>. Optional: <code>client_id,site_id,status,vendor,product,model,serial_number,ip_address,mac_address,external_vault_reference,tags,notes</code>. Preview detects duplicates and row errors before anything is written.</p><Textarea className="min-h-52 font-mono text-xs" value={csv} onChange={(event) => { setCsv(event.target.value); setPreview(null); }} placeholder="name,item_type,client_id,site_id,ip_address,notes" /><div className="flex gap-2"><Button variant="outline" disabled={!csv} onClick={previewImport}>Preview validation</Button>{preview && <Button disabled={!preview.valid} onClick={commitImport}>Import {preview.valid} valid rows</Button>}</div>{preview && <div className="rounded-lg border p-4"><div className="flex flex-wrap gap-3 text-sm"><span>{preview.total} rows</span><span className="text-emerald-500">{preview.valid} valid</span><span className="text-amber-500">{preview.rows.filter((row: any) => row.duplicate).length} duplicates</span><span className="text-destructive">{preview.rows.filter((row: any) => row.errors.length).length} invalid</span></div><div className="mt-3 max-h-48 overflow-auto space-y-1 text-xs">{preview.rows.filter((row: any) => row.duplicate || row.errors.length).map((row: any) => <div key={row.row} className="font-mono">Row {row.row}: {row.duplicate ? "duplicate name" : row.errors.join(", ")}</div>)}</div></div>}</CardContent></Card></TabsContent>
      </Tabs>

      <Dialog open={Boolean(selectedId)} onOpenChange={(open) => !open && setSelectedId(null)}>
        <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
          {selected && <><DialogHeader><div className="flex items-start justify-between gap-4 pr-8"><div><DialogTitle className="text-xl">{selected.name}</DialogTitle><DialogDescription>{pretty(selected.itemType)} · {selected.clientName || "Shared inventory"} · {selected.siteName || "No site"}</DialogDescription></div><StatusBadge status={selected.status} /></div></DialogHeader>
            {selected.itemType === "credential_reference" && <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm flex gap-2"><KeyRound className="h-4 w-4 mt-0.5 text-amber-500" /><div><p className="font-medium">External vault reference only</p><p className="text-muted-foreground break-all">{selected.externalVaultReference || "No vault reference configured"}</p></div></div>}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Detail label="IP address" value={selected.ipAddress} mono /><Detail label="Serial / ID" value={selected.serialNumber} mono /><Detail label="Vendor" value={selected.vendor} /><Detail label="Owner" value={selected.owner} /></div>
            {Object.keys(selected.details || {}).length > 0 && <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Technical details</CardTitle></CardHeader><CardContent className="grid gap-2 sm:grid-cols-2">{Object.entries(selected.details).map(([key, value]) => <div key={key} className="flex justify-between gap-4 border-b py-1 text-sm"><span className="text-muted-foreground">{pretty(key)}</span><code>{String(value)}</code></div>)}</CardContent></Card>}
            <div className="grid gap-4 lg:grid-cols-2">
              <Card><CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><ArrowRightLeft className="h-4 w-4" />Relationships</CardTitle></CardHeader><CardContent className="space-y-3">{selected.relationships?.map((relationship) => { const otherId = relationship.sourceItemId === selected.id ? relationship.targetItemId : relationship.sourceItemId; const other = items.find((item) => item.id === otherId); return <div key={relationship.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"><span>{pretty(relationship.relationshipType)} <strong>{other?.name || otherId}</strong></span></div>; })}<div className="grid grid-cols-[1fr_140px_auto] gap-2"><Select value={relationshipTarget} onValueChange={setRelationshipTarget}><SelectTrigger><SelectValue placeholder="Target record" /></SelectTrigger><SelectContent>{items.filter((item) => item.id !== selected.id).map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select><Select value={relationshipType} onValueChange={setRelationshipType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["depends_on", "connects_to", "hosts", "routes_to", "backs_up", "assigned_to", "covered_by"].map((type) => <SelectItem key={type} value={type}>{pretty(type)}</SelectItem>)}</SelectContent></Select><Button size="icon" disabled={!relationshipTarget || createRelationship.isPending} onClick={() => createRelationship.mutate()}><Link2 className="h-4 w-4" /></Button></div></CardContent></Card>
              <Card><CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><ShieldCheck className="h-4 w-4" />Evidence attachments</CardTitle></CardHeader><CardContent className="space-y-3">{selected.attachments?.map((row) => <a key={row.attachment.id} href={`/evidence/${row.attachment.evidenceItemId}`} className="block rounded-md border px-3 py-2 text-sm hover:bg-muted"><strong>{row.evidenceTitle}</strong><div className="text-xs text-muted-foreground">{row.fileName}</div></a>)}<div className="grid grid-cols-[1fr_auto] gap-2"><Select value={selectedEvidence} onValueChange={setSelectedEvidence}><SelectTrigger><SelectValue placeholder="Choose evidence" /></SelectTrigger><SelectContent>{evidence.map((item) => <SelectItem key={item.id} value={item.id}>{item.title}</SelectItem>)}</SelectContent></Select><Button size="icon" disabled={!selectedEvidence || linkEvidence.isPending} onClick={() => linkEvidence.mutate()}><Plus className="h-4 w-4" /></Button></div></CardContent></Card>
            </div>
            {selected.notes && <div className="rounded-lg bg-muted/50 p-4 text-sm whitespace-pre-wrap">{selected.notes}</div>}
            <DialogFooter><Button variant="destructive" onClick={() => deleteItem.mutate(selected.id)}><Trash2 className="h-4 w-4 mr-2" />Delete</Button><Button variant="outline" onClick={() => setSelectedId(null)}>Close</Button></DialogFooter>
          </>}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>; }
function Metric({ icon: Icon, label, value, warning = false }: { icon: typeof Server; label: string; value: number; warning?: boolean }) { return <Card><CardContent className="flex items-center gap-3 p-4"><div className={`rounded-lg p-2 ${warning ? "bg-amber-500/10 text-amber-500" : "bg-primary/10 text-primary"}`}><Icon className="h-5 w-5" /></div><div><p className="text-2xl font-bold">{value}</p><p className="text-xs text-muted-foreground">{label}</p></div></CardContent></Card>; }
function StatusBadge({ status }: { status: string }) { const okay = status === "active"; const warn = status === "warning" || status === "expired"; return <Badge variant={warn ? "destructive" : okay ? "default" : "secondary"}>{okay && <CheckCircle2 className="h-3 w-3 mr-1" />}{warn && <AlertTriangle className="h-3 w-3 mr-1" />}{pretty(status)}</Badge>; }
function Detail({ label, value, mono = false }: { label: string; value?: string | null; mono?: boolean }) { return <div className="rounded-lg border p-3"><p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p><p className={`mt-1 text-sm ${mono ? "font-mono" : "font-medium"}`}>{value || "—"}</p></div>; }
