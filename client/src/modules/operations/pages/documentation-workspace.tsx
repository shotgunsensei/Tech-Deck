import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { BookOpen, Clock3, Download, FileCode2, FileText, Folder, FolderPlus, Link2, Plus, Save, Search, ShieldCheck, Trash2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { Client, EvidenceItem } from "@shared/schema";
import type { DocumentationPage } from "../types";

interface DocumentationFolder {
  id: string;
  clientId: string | null;
  parentId: string | null;
  name: string;
}

const emptyEditor = {
  title: "", summary: "", content: "", pageType: "documentation", status: "draft", category: "",
  minimumRole: "TECH", tags: "", clientId: "none", folderId: "none", changeNote: "",
};

function pretty(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function nullable(value: string) {
  return value.trim() || null;
}

export default function DocumentationWorkspace() {
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [folderFilter, setFolderFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);
  const [newFolder, setNewFolder] = useState({ name: "", parentId: "none", clientId: "none" });
  const [editor, setEditor] = useState(emptyEditor);
  const [selectedEvidence, setSelectedEvidence] = useState("");

  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (folderFilter !== "all") params.set("folderId", folderFilter);
  if (typeFilter !== "all") params.set("pageType", typeFilter);
  const listUrl = `/api/ops/documents?${params.toString()}`;

  const { data: documents = [], isLoading } = useQuery<DocumentationPage[]>({ queryKey: [listUrl] });
  const { data: selected } = useQuery<DocumentationPage>({ queryKey: ["/api/ops/documents", selectedId], enabled: Boolean(selectedId) });
  const { data: folders = [] } = useQuery<DocumentationFolder[]>({ queryKey: ["/api/ops/folders"] });
  const { data: clients = [] } = useQuery<Client[]>({ queryKey: ["/api/clients"] });
  const { data: evidence = [] } = useQuery<EvidenceItem[]>({ queryKey: ["/api/evidence"] });

  useEffect(() => {
    if (creating) return;
    if (!selected) return;
    setEditor({
      title: selected.title, summary: selected.summary || "", content: selected.content, pageType: selected.pageType,
      status: selected.status, category: selected.category || "", minimumRole: selected.minimumRole,
      tags: selected.tags.join(", "), clientId: selected.clientId || "none", folderId: selected.folderId || "none", changeNote: "",
    });
  }, [selected, creating]);

  const folderTree = useMemo(() => {
    const depth = (folder: DocumentationFolder): number => folder.parentId ? 1 + depth(folders.find((candidate) => candidate.id === folder.parentId) || { ...folder, parentId: null }) : 0;
    return [...folders].sort((a, b) => depth(a) - depth(b) || a.name.localeCompare(b.name)).map((folder) => ({ ...folder, depth: depth(folder) }));
  }, [folders]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: [listUrl] });
    queryClient.invalidateQueries({ queryKey: ["/api/ops/documents"] });
    queryClient.invalidateQueries({ queryKey: ["/api/ops/summary"] });
  };

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        ...editor, clientId: editor.clientId === "none" ? null : editor.clientId,
        folderId: editor.folderId === "none" ? null : editor.folderId, siteId: null,
        summary: nullable(editor.summary), category: nullable(editor.category),
        tags: editor.tags.split(",").map((tag) => tag.trim()).filter(Boolean), changeNote: nullable(editor.changeNote),
      };
      const response = await apiRequest(creating ? "POST" : "PATCH", creating ? "/api/ops/documents" : `/api/ops/documents/${selectedId}`, body);
      return response.json();
    },
    onSuccess: (page: DocumentationPage) => {
      setCreating(false); setSelectedId(page.id); refresh(); queryClient.invalidateQueries({ queryKey: ["/api/ops/documents", page.id] });
      toast({ title: selectedId ? `Revision ${page.version} saved` : "Document created", description: `${page.title} is ${page.status}.` });
    },
    onError: (error: Error) => toast({ title: "Document save failed", description: error.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/ops/documents/${id}`),
    onSuccess: () => { setSelectedId(null); setCreating(false); setEditor(emptyEditor); refresh(); toast({ title: "Document deleted" }); },
    onError: (error: Error) => toast({ title: "Delete failed", description: error.message, variant: "destructive" }),
  });

  const createFolder = useMutation({
    mutationFn: () => apiRequest("POST", "/api/ops/folders", { name: newFolder.name, parentId: newFolder.parentId === "none" ? null : newFolder.parentId, clientId: newFolder.clientId === "none" ? null : newFolder.clientId }),
    onSuccess: () => { setFolderOpen(false); setNewFolder({ name: "", parentId: "none", clientId: "none" }); queryClient.invalidateQueries({ queryKey: ["/api/ops/folders"] }); toast({ title: "Folder created" }); },
    onError: (error: Error) => toast({ title: "Folder creation failed", description: error.message, variant: "destructive" }),
  });

  const linkEvidence = useMutation({
    mutationFn: () => apiRequest("POST", "/api/ops/attachments", { evidenceItemId: selectedEvidence, configurationItemId: null, documentationPageId: selectedId, label: null }),
    onSuccess: () => { setSelectedEvidence(""); queryClient.invalidateQueries({ queryKey: ["/api/ops/documents", selectedId] }); toast({ title: "Evidence attached" }); },
    onError: (error: Error) => toast({ title: "Attachment failed", description: error.message, variant: "destructive" }),
  });

  const startNew = (pageType = "documentation") => {
    setSelectedId(null); setCreating(true); setEditor({ ...emptyEditor, pageType, folderId: folderFilter === "all" ? "none" : folderFilter });
  };

  const active = creating || selectedId;

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-[1600px] mx-auto">
      <section className="relative overflow-hidden rounded-xl border bg-card p-5 md:p-7">
        <div className="absolute inset-0 bg-[linear-gradient(120deg,hsl(var(--primary)/0.12),transparent_45%)] pointer-events-none" />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div><div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary"><BookOpen className="h-4 w-4" /> Living technical knowledge</div><h1 className="text-2xl md:text-3xl font-bold tracking-tight">Documentation workspace</h1><p className="mt-2 max-w-3xl text-sm text-muted-foreground">Hierarchical client documentation, runbooks, procedures, cross-links, role restrictions, attachments, and immutable revision history.</p></div>
          <div className="flex flex-wrap gap-2"><Dialog open={folderOpen} onOpenChange={setFolderOpen}><DialogTrigger asChild><Button variant="outline"><FolderPlus className="h-4 w-4 mr-2" />New folder</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>Create documentation folder</DialogTitle><DialogDescription>Folders can be nested and optionally scoped to a client.</DialogDescription></DialogHeader><div className="space-y-4"><Field label="Name"><Input value={newFolder.name} onChange={(event) => setNewFolder({ ...newFolder, name: event.target.value })} /></Field><Field label="Parent folder"><Select value={newFolder.parentId} onValueChange={(value) => setNewFolder({ ...newFolder, parentId: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Root</SelectItem>{folderTree.map((folder) => <SelectItem key={folder.id} value={folder.id}>{"— ".repeat(folder.depth)}{folder.name}</SelectItem>)}</SelectContent></Select></Field><Field label="Client"><Select value={newFolder.clientId} onValueChange={(value) => setNewFolder({ ...newFolder, clientId: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Shared</SelectItem>{clients.map((client) => <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>)}</SelectContent></Select></Field></div><DialogFooter><Button disabled={!newFolder.name || createFolder.isPending} onClick={() => createFolder.mutate()}>Create folder</Button></DialogFooter></DialogContent></Dialog><Button onClick={() => startNew()}><Plus className="h-4 w-4 mr-2" />New document</Button></div>
        </div>
      </section>

      <div className="grid min-h-[680px] gap-4 lg:grid-cols-[220px_340px_minmax(0,1fr)]">
        <Card className="h-fit lg:sticky lg:top-20"><CardHeader className="pb-2"><CardTitle className="text-sm uppercase tracking-wider text-muted-foreground">Workspace tree</CardTitle></CardHeader><CardContent className="space-y-1"><Button variant={folderFilter === "all" ? "secondary" : "ghost"} className="w-full justify-start" onClick={() => setFolderFilter("all")}><BookOpen className="h-4 w-4 mr-2" />All documents</Button>{folderTree.map((folder) => <Button key={folder.id} variant={folderFilter === folder.id ? "secondary" : "ghost"} className="w-full justify-start" style={{ paddingLeft: `${12 + folder.depth * 16}px` }} onClick={() => setFolderFilter(folder.id)}><Folder className="h-4 w-4 mr-2" /><span className="truncate">{folder.name}</span></Button>)}</CardContent></Card>

        <Card className="overflow-hidden"><CardHeader className="space-y-3 pb-3"><div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pl-9" placeholder="Search documentation…" value={query} onChange={(event) => setQuery(event.target.value)} /></div><Select value={typeFilter} onValueChange={setTypeFilter}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All document types</SelectItem>{["documentation", "runbook", "procedure", "knowledge_article"].map((type) => <SelectItem key={type} value={type}>{pretty(type)}</SelectItem>)}</SelectContent></Select></CardHeader><CardContent className="p-2 pt-0"><div className="space-y-1 max-h-[650px] overflow-auto">{isLoading ? <p className="p-6 text-center text-sm text-muted-foreground">Loading documentation…</p> : documents.length === 0 ? <div className="p-7 text-center"><FileText className="mx-auto h-8 w-8 text-muted-foreground/50" /><p className="mt-3 font-medium">No documents found</p><Button variant="link" onClick={() => startNew()}>Create the first document</Button></div> : documents.map((document) => <button key={document.id} onClick={() => { setCreating(false); setSelectedId(document.id); }} className={`w-full rounded-lg border p-3 text-left transition-colors ${selectedId === document.id ? "border-primary bg-primary/5" : "border-transparent hover:bg-muted/60"}`}><div className="flex items-start justify-between gap-2"><span className="font-medium leading-tight">{document.title}</span><Badge variant={document.status === "published" ? "default" : "secondary"} className="text-[10px]">{document.status}</Badge></div><p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{document.summary || "No summary"}</p><div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground"><span>{pretty(document.pageType)}</span><span>v{document.version}</span></div></button>)}</div></CardContent></Card>

        {!active ? <Card className="flex min-h-[520px] items-center justify-center"><CardContent className="max-w-md text-center"><FileCode2 className="mx-auto h-12 w-12 text-primary/50" /><h2 className="mt-4 text-xl font-semibold">Select a document or start a runbook</h2><p className="mt-2 text-sm text-muted-foreground">Use Markdown for portable technical notes. Cross-link documents with <code>[[document-slug]]</code>; backlinks appear automatically.</p><div className="mt-5 flex justify-center gap-2"><Button variant="outline" onClick={() => startNew("runbook")}>New runbook</Button><Button onClick={() => startNew("procedure")}>New procedure</Button></div></CardContent></Card> : <Card><CardHeader className="border-b"><div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between"><div><CardTitle>{creating ? "New document" : selected?.title || "Loading…"}</CardTitle>{selected && <p className="mt-1 text-xs text-muted-foreground">Slug: {selected.slug} · Version {selected.version}</p>}</div><div className="flex flex-wrap gap-2">{selectedId && <Button variant="outline" size="sm" asChild><a href={`/api/ops/documents/export?ids=${selectedId}`}><Download className="h-4 w-4 mr-2" />Export</a></Button>}<Button size="sm" disabled={!editor.title || save.isPending} onClick={() => save.mutate()}><Save className="h-4 w-4 mr-2" />{save.isPending ? "Saving…" : "Save revision"}</Button></div></div></CardHeader><CardContent className="p-4 md:p-5">
          <Tabs defaultValue="edit"><TabsList><TabsTrigger value="edit">Edit</TabsTrigger><TabsTrigger value="preview">Safe preview</TabsTrigger>{selected && <TabsTrigger value="history">History</TabsTrigger>}{selected && <TabsTrigger value="links">Links & evidence</TabsTrigger>}</TabsList>
            <TabsContent value="edit" className="mt-4 space-y-4"><div className="grid gap-4 sm:grid-cols-2"><div className="sm:col-span-2"><Field label="Title"><Input value={editor.title} onChange={(event) => setEditor({ ...editor, title: event.target.value })} /></Field></div><Field label="Type"><Select value={editor.pageType} onValueChange={(value) => setEditor({ ...editor, pageType: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["documentation", "runbook", "procedure", "knowledge_article"].map((type) => <SelectItem key={type} value={type}>{pretty(type)}</SelectItem>)}</SelectContent></Select></Field><Field label="Status"><Select value={editor.status} onValueChange={(value) => setEditor({ ...editor, status: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["draft", "published", "archived"].map((status) => <SelectItem key={status} value={status}>{pretty(status)}</SelectItem>)}</SelectContent></Select></Field><Field label="Client"><Select value={editor.clientId} onValueChange={(value) => setEditor({ ...editor, clientId: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Shared</SelectItem>{clients.map((client) => <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>)}</SelectContent></Select></Field><Field label="Folder"><Select value={editor.folderId} onValueChange={(value) => setEditor({ ...editor, folderId: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Root</SelectItem>{folderTree.map((folder) => <SelectItem key={folder.id} value={folder.id}>{"— ".repeat(folder.depth)}{folder.name}</SelectItem>)}</SelectContent></Select></Field><Field label="Minimum role"><Select value={editor.minimumRole} onValueChange={(value) => setEditor({ ...editor, minimumRole: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["TECH", "ADMIN", "OWNER"].map((role) => <SelectItem key={role} value={role}>{role}</SelectItem>)}</SelectContent></Select></Field><Field label="Category"><Input value={editor.category} onChange={(event) => setEditor({ ...editor, category: event.target.value })} /></Field><div className="sm:col-span-2"><Field label="Summary"><Textarea className="min-h-20" value={editor.summary} onChange={(event) => setEditor({ ...editor, summary: event.target.value })} /></Field></div><div className="sm:col-span-2"><Field label="Markdown content"><Textarea className="min-h-[340px] font-mono text-sm" value={editor.content} onChange={(event) => setEditor({ ...editor, content: event.target.value })} placeholder="# Purpose\n\n## Preconditions\n\n## Procedure\n\nLink to [[another-document]]." /></Field><p className="mt-1 text-xs text-muted-foreground">HTML scripts, iframes, event handlers, and javascript URLs are stripped server-side. Preview never renders raw HTML.</p></div><Field label="Tags"><Input value={editor.tags} onChange={(event) => setEditor({ ...editor, tags: event.target.value })} placeholder="windows, escalation, firewall" /></Field><Field label="Revision note"><Input value={editor.changeNote} onChange={(event) => setEditor({ ...editor, changeNote: event.target.value })} placeholder="What changed?" /></Field></div></TabsContent>
            <TabsContent value="preview" className="mt-4"><article className="min-h-[500px] rounded-lg border bg-muted/20 p-6"><div className="border-b pb-4"><Badge variant="outline">{pretty(editor.pageType)}</Badge><h1 className="mt-3 text-2xl font-bold">{editor.title || "Untitled document"}</h1>{editor.summary && <p className="mt-2 text-muted-foreground">{editor.summary}</p>}</div><pre className="mt-5 whitespace-pre-wrap break-words font-sans text-sm leading-7">{editor.content || "Nothing written yet."}</pre></article></TabsContent>
            {selected && <TabsContent value="history" className="mt-4 space-y-2">{selected.revisions?.map((revision) => <div key={revision.id} className="flex items-center justify-between rounded-lg border p-3"><div className="flex items-center gap-3"><Clock3 className="h-4 w-4 text-primary" /><div><p className="font-medium">Version {revision.version}</p><p className="text-xs text-muted-foreground">{revision.changeNote || "No revision note"}</p></div></div><span className="text-xs text-muted-foreground">{revision.createdAt ? new Date(revision.createdAt).toLocaleString() : ""}</span></div>)}</TabsContent>}
            {selected && <TabsContent value="links" className="mt-4 grid gap-4 xl:grid-cols-2"><Card><CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Link2 className="h-4 w-4" />Backlinks</CardTitle></CardHeader><CardContent>{selected.backlinks?.length ? selected.backlinks.map((link) => <button key={link.id} onClick={() => setSelectedId(link.id)} className="block w-full rounded-md border p-3 text-left text-sm hover:bg-muted">{link.title}<span className="block text-xs text-muted-foreground">[[{link.slug}]]</span></button>) : <p className="text-sm text-muted-foreground">No documents link here yet.</p>}</CardContent></Card><Card><CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><ShieldCheck className="h-4 w-4" />Evidence attachments</CardTitle></CardHeader><CardContent className="space-y-3">{selected.attachments?.map((row) => <a key={row.attachment.id} href={`/evidence/${row.attachment.evidenceItemId}`} className="block rounded-md border p-3 text-sm hover:bg-muted"><strong>{row.evidenceTitle}</strong><span className="block text-xs text-muted-foreground">{row.fileName}</span></a>)}<div className="grid grid-cols-[1fr_auto] gap-2"><Select value={selectedEvidence} onValueChange={setSelectedEvidence}><SelectTrigger><SelectValue placeholder="Choose evidence" /></SelectTrigger><SelectContent>{evidence.map((item) => <SelectItem key={item.id} value={item.id}>{item.title}</SelectItem>)}</SelectContent></Select><Button size="icon" disabled={!selectedEvidence || linkEvidence.isPending} onClick={() => linkEvidence.mutate()}><Plus className="h-4 w-4" /></Button></div></CardContent></Card></TabsContent>}
          </Tabs>
          <div className="mt-5 flex justify-between border-t pt-4"><div className="flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="h-4 w-4 text-emerald-500" />Tenant scoped · Role restricted · Revision audited</div>{selectedId && <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => remove.mutate(selectedId)}><Trash2 className="h-4 w-4 mr-2" />Delete</Button>}</div>
        </CardContent></Card>}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>;
}
