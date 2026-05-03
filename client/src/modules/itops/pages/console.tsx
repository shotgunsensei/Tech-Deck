import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Zap,
  Code2,
  Search,
  Network,
  Server,
  Copy,
  Check,
  RotateCcw,
  Send,
  Loader2,
  Terminal,
  Trash2,
  BookmarkPlus,
  Archive,
  Download,
  FileText,
  Tag,
  X,
  CopyPlus,
} from "lucide-react";

type OpsMode = "quick-fix" | "script-builder" | "deep-dive" | "network" | "system-design";

interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
}

interface QueryEntry {
  id: string;
  query: string;
  response: string;
  mode: OpsMode;
  timestamp: number;
}

interface VaultEntry {
  id: string;
  query: string;
  response: string;
  mode: OpsMode;
  tags: string[];
  savedAt: number;
}

const MODES: { id: OpsMode; label: string; icon: typeof Zap; desc: string }[] = [
  { id: "quick-fix", label: "Quick Fix", icon: Zap, desc: "Fastest resolution path" },
  { id: "script-builder", label: "Script Builder", icon: Code2, desc: "Production-ready scripts" },
  { id: "deep-dive", label: "Deep Dive", icon: Search, desc: "Root cause analysis" },
  { id: "network", label: "Network", icon: Network, desc: "Layer-by-layer diagnostics" },
  { id: "system-design", label: "System Design", icon: Server, desc: "Architecture decisions" },
];

const LS_HISTORY_KEY = "itops_history";
const LS_VAULT_KEY = "itops_vault";

function loadHistory(): QueryEntry[] {
  try {
    const raw = localStorage.getItem(LS_HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveHistory(entries: QueryEntry[]) {
  localStorage.setItem(LS_HISTORY_KEY, JSON.stringify(entries.slice(0, 5)));
}

function loadVault(): VaultEntry[] {
  try {
    const raw = localStorage.getItem(LS_VAULT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveVault(entries: VaultEntry[]) {
  localStorage.setItem(LS_VAULT_KEY, JSON.stringify(entries));
}

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-300 transition-colors"
      data-testid="button-copy-code"
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copied ? "Copied" : (label || "Copy")}
    </button>
  );
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function highlightSyntax(code: string, lang: string): JSX.Element[] {
  const lines = code.split("\n");
  return lines.map((line, idx) => {
    let highlighted = escapeHtml(line);

    if (lang === "powershell" || lang === "ps1") {
      highlighted = highlighted
        .replace(/(#.*)$/gm, '<span class="text-zinc-500 italic">$1</span>')
        .replace(/(\$\w+)/g, '<span class="text-sky-400">$1</span>')
        .replace(/\b(function|param|if|else|elseif|foreach|for|while|try|catch|finally|return|throw|switch|break|continue|Import-Module|Write-Host|Write-Output|Write-Error|Get-|Set-|New-|Remove-|Invoke-|Test-|Start-|Stop-|Restart-)\b/g, '<span class="text-violet-400">$1</span>')
        .replace(/(&quot;[^&]*&quot;)/g, '<span class="text-amber-300">$1</span>')
        .replace(/(&#039;[^&]*&#039;)/g, '<span class="text-amber-300">$1</span>');
    } else if (lang === "bash" || lang === "sh" || lang === "shell" || !lang) {
      highlighted = highlighted
        .replace(/(#.*)$/gm, '<span class="text-zinc-500 italic">$1</span>')
        .replace(/(\$\w+|\$\{[^}]+\})/g, '<span class="text-sky-400">$1</span>')
        .replace(/\b(if|then|else|elif|fi|for|do|done|while|case|esac|function|return|exit|echo|sudo|grep|awk|sed|find|curl|wget|chmod|chown|mkdir|rm|cp|mv|cat|systemctl|journalctl|apt|yum|dnf|pip|npm)\b/g, '<span class="text-violet-400">$1</span>')
        .replace(/(&quot;[^&]*&quot;)/g, '<span class="text-amber-300">$1</span>')
        .replace(/(&#039;[^&]*&#039;)/g, '<span class="text-amber-300">$1</span>');
    } else if (lang === "python" || lang === "py") {
      highlighted = highlighted
        .replace(/(#.*)$/gm, '<span class="text-zinc-500 italic">$1</span>')
        .replace(/\b(def|class|import|from|if|elif|else|for|while|try|except|finally|return|raise|with|as|pass|break|continue|True|False|None|and|or|not|in|is|lambda|yield|async|await)\b/g, '<span class="text-violet-400">$1</span>')
        .replace(/(&quot;[^&]*&quot;)/g, '<span class="text-amber-300">$1</span>')
        .replace(/(&#039;[^&]*&#039;)/g, '<span class="text-amber-300">$1</span>')
        .replace(/\b(\d+)\b/g, '<span class="text-orange-400">$1</span>');
    }

    return (
      <div key={idx} className="leading-relaxed" dangerouslySetInnerHTML={{ __html: highlighted || "&nbsp;" }} />
    );
  });
}

function ResponseBlock({ content }: { content: string }) {
  const sections = parseResponse(content);

  return (
    <div className="space-y-3">
      {sections.map((section, i) => (
        <div key={i}>
          {section.type === "heading" && (
            <div className="flex items-center gap-2 mb-1 mt-2 first:mt-0">
              <span className="text-[11px] font-bold uppercase tracking-widest text-emerald-400">
                {section.content}
              </span>
              <div className="flex-1 h-px bg-zinc-800" />
            </div>
          )}
          {section.type === "code" && (
            <div className="relative group">
              <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-t text-[10px] text-zinc-500 font-mono">
                <span>{section.lang || "shell"}</span>
                <CopyButton text={section.content} />
              </div>
              <pre className="px-3 py-2 bg-zinc-950 border border-t-0 border-zinc-800 rounded-b overflow-x-auto text-[13px] font-mono text-zinc-200">
                <code>{highlightSyntax(section.content, section.lang || "")}</code>
              </pre>
            </div>
          )}
          {section.type === "text" && (
            <div className="text-[13px] leading-relaxed text-zinc-300 whitespace-pre-wrap">
              {section.content}
            </div>
          )}
          {section.type === "table" && (
            <div className="overflow-x-auto border border-zinc-800 rounded">
              <pre className="px-3 py-2 text-[12px] leading-relaxed text-zinc-300 font-mono">
                {section.content}
              </pre>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

interface ParsedSection {
  type: "heading" | "code" | "text" | "table";
  content: string;
  lang?: string;
}

function parseResponse(raw: string): ParsedSection[] {
  const sections: ParsedSection[] = [];
  const lines = raw.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (/^\[.*\]$/.test(line.trim())) {
      sections.push({ type: "heading", content: line.trim().replace(/^\[|\]$/g, "") });
      i++;
      continue;
    }

    if (line.trim().startsWith("```")) {
      const lang = line.trim().replace(/^```/, "").trim();
      i++;
      const codeLines: string[] = [];
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++;
      sections.push({ type: "code", content: codeLines.join("\n"), lang });
      continue;
    }

    if (line.includes("|") && line.trim().startsWith("|")) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim().startsWith("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      sections.push({ type: "table", content: tableLines.join("\n") });
      continue;
    }

    if (line.trim() === "") {
      i++;
      continue;
    }

    const textLines: string[] = [];
    while (
      i < lines.length &&
      !lines[i].trim().startsWith("```") &&
      !/^\[.*\]$/.test(lines[i].trim()) &&
      !(lines[i].includes("|") && lines[i].trim().startsWith("|"))
    ) {
      if (lines[i].trim() === "" && textLines.length > 0) {
        textLines.push("");
        i++;
        continue;
      }
      textLines.push(lines[i]);
      i++;
    }

    const joined = textLines.join("\n").trim();
    if (joined) {
      sections.push({ type: "text", content: joined });
    }
  }

  return sections;
}

function formatResponseAsMarkdown(query: string, response: string, mode: string): string {
  return `# IT Ops Console — ${mode.replace("-", " ").toUpperCase()}\n\n**Query:** ${query}\n\n---\n\n${response}`;
}

function VaultDialog({
  open,
  onClose,
  vault,
  setVault,
  onLoad,
}: {
  open: boolean;
  onClose: () => void;
  vault: VaultEntry[];
  setVault: (v: VaultEntry[]) => void;
  onLoad: (entry: VaultEntry) => void;
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [filterTag, setFilterTag] = useState("");

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    vault.forEach((e) => e.tags.forEach((t) => tags.add(t)));
    return Array.from(tags).sort();
  }, [vault]);

  const filtered = useMemo(() => {
    return vault.filter((e) => {
      const matchSearch = !searchTerm ||
        e.query.toLowerCase().includes(searchTerm.toLowerCase()) ||
        e.response.toLowerCase().includes(searchTerm.toLowerCase());
      const matchTag = !filterTag || e.tags.includes(filterTag);
      return matchSearch && matchTag;
    });
  }, [vault, searchTerm, filterTag]);

  const deleteEntry = (id: string) => {
    const updated = vault.filter((e) => e.id !== id);
    setVault(updated);
    saveVault(updated);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl bg-zinc-950 border-zinc-800 text-zinc-100 max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-zinc-200">
            <Archive className="w-4 h-4 text-emerald-400" />
            Knowledge Vault
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2 mt-2">
          <Input
            placeholder="Search saved outputs..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="bg-zinc-900 border-zinc-800 text-zinc-100 text-sm"
            data-testid="input-vault-search"
          />
          {allTags.length > 0 && (
            <select
              value={filterTag}
              onChange={(e) => setFilterTag(e.target.value)}
              className="bg-zinc-900 border border-zinc-800 text-zinc-300 text-sm rounded px-2 py-2 min-w-[120px]"
              data-testid="select-vault-filter"
            >
              <option value="">All tags</option>
              {allTags.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          )}
        </div>

        <div className="flex-1 overflow-y-auto mt-3 space-y-2 min-h-0">
          {filtered.length === 0 && (
            <div className="text-center py-8 text-zinc-600 text-sm">
              {vault.length === 0 ? "No saved outputs yet. Save responses to build your vault." : "No matches found."}
            </div>
          )}
          {filtered.map((entry) => (
            <div
              key={entry.id}
              className="border border-zinc-800 rounded p-3 hover:border-zinc-700 transition-colors"
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="flex-1 min-w-0">
                  <span className="text-[10px] uppercase tracking-wider text-emerald-400/70 font-medium">
                    {entry.mode.replace("-", " ")}
                  </span>
                  <p className="text-xs text-zinc-300 truncate mt-0.5">{entry.query}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => { onLoad(entry); onClose(); }}
                    className="px-2 py-1 text-[10px] rounded bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 transition-colors"
                    data-testid={`button-vault-load-${entry.id}`}
                  >
                    Load
                  </button>
                  <button
                    onClick={() => deleteEntry(entry.id)}
                    className="p-1 text-zinc-600 hover:text-red-400 transition-colors"
                    data-testid={`button-vault-delete-${entry.id}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              </div>
              {entry.tags.length > 0 && (
                <div className="flex gap-1 mt-1">
                  {entry.tags.map((t) => (
                    <Badge key={t} variant="secondary" className="text-[9px] bg-zinc-800 text-zinc-400 px-1.5 py-0">
                      {t}
                    </Badge>
                  ))}
                </div>
              )}
              <p className="text-[11px] text-zinc-600 mt-1">
                {new Date(entry.savedAt).toLocaleDateString()} {new Date(entry.savedAt).toLocaleTimeString()}
              </p>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SaveDialog({
  open,
  onClose,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (tags: string[]) => void;
}) {
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>([]);

  const addTag = () => {
    const t = tagInput.trim().toLowerCase();
    if (t && !tags.includes(t)) {
      setTags([...tags, t]);
    }
    setTagInput("");
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm bg-zinc-950 border-zinc-800 text-zinc-100">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-zinc-200">
            <BookmarkPlus className="w-4 h-4 text-emerald-400" />
            Save to Vault
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 mt-2">
          <div>
            <label className="text-[11px] text-zinc-500 uppercase tracking-wider mb-1 block">Tags (optional)</label>
            <div className="flex gap-1">
              <Input
                placeholder="Add tag..."
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
                className="bg-zinc-900 border-zinc-800 text-zinc-100 text-sm"
                data-testid="input-vault-tag"
              />
              <Button size="sm" variant="outline" onClick={addTag} className="border-zinc-800 text-zinc-400 shrink-0">
                <Tag className="w-3 h-3" />
              </Button>
            </div>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {tags.map((t) => (
                  <Badge
                    key={t}
                    variant="secondary"
                    className="text-[10px] bg-zinc-800 text-zinc-300 cursor-pointer hover:bg-red-900/30 hover:text-red-400"
                    onClick={() => setTags(tags.filter((x) => x !== t))}
                  >
                    {t} <X className="w-2.5 h-2.5 ml-0.5" />
                  </Badge>
                ))}
              </div>
            )}
          </div>
          <Button
            onClick={() => { onSave(tags); onClose(); setTags([]); }}
            className="w-full bg-emerald-600 hover:bg-emerald-500 text-white"
            data-testid="button-vault-save-confirm"
          >
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ItOpsConsolePage() {
  const [mode, setMode] = useState<OpsMode>("quick-fix");
  const [query, setQuery] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentResponse, setCurrentResponse] = useState("");
  const [currentQuery, setCurrentQuery] = useState("");
  const [history, setHistory] = useState<QueryEntry[]>(() => loadHistory());
  const [conversationHistory, setConversationHistory] = useState<HistoryMessage[]>([]);
  const [vault, setVault] = useState<VaultEntry[]>(() => loadVault());
  const [showVault, setShowVault] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const responseRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (responseRef.current) {
      responseRef.current.scrollTop = responseRef.current.scrollHeight;
    }
  }, [currentResponse]);

  const handleSubmit = useCallback(async (queryText?: string, overrideMode?: OpsMode) => {
    const q = queryText || query;
    if (!q.trim() || isStreaming) return;

    const activeMode = overrideMode || mode;

    setIsStreaming(true);
    setCurrentResponse("");
    setCurrentQuery(q.trim());
    setQuery("");
    if (overrideMode) setMode(overrideMode);

    let accumulated = "";

    try {
      const res = await fetch("/api/itops/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          query: q.trim(),
          mode: activeMode,
          history: conversationHistory.slice(-10),
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || "Request failed");
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.content) {
              accumulated += event.content;
              setCurrentResponse(accumulated);
            }
            if (event.error) {
              throw new Error(event.error);
            }
          } catch (e) {
            if (!(e instanceof SyntaxError)) throw e;
          }
        }
      }

      const entry: QueryEntry = {
        id: Date.now().toString(),
        query: q.trim(),
        response: accumulated,
        mode: activeMode,
        timestamp: Date.now(),
      };

      const updatedHistory = [entry, ...history].slice(0, 5);
      setHistory(updatedHistory);
      saveHistory(updatedHistory);

      setConversationHistory((prev) => [
        ...prev,
        { role: "user" as const, content: q.trim() },
        { role: "assistant" as const, content: accumulated },
      ].slice(-20));
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to process query",
        variant: "destructive",
      });
      setCurrentResponse("");
    } finally {
      setIsStreaming(false);
      inputRef.current?.focus();
    }
  }, [query, mode, conversationHistory, isStreaming, toast, history]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleReuseLast = () => {
    if (history.length > 0) {
      const last = history[0];
      handleSubmit(last.query, last.mode);
    }
  };

  const clearSession = () => {
    setCurrentResponse("");
    setCurrentQuery("");
    setConversationHistory([]);
    setHistory([]);
    saveHistory([]);
  };

  const handleSaveToVault = (tags: string[]) => {
    if (!currentResponse || !currentQuery) return;
    const entry: VaultEntry = {
      id: Date.now().toString(),
      query: currentQuery,
      response: currentResponse,
      mode,
      tags,
      savedAt: Date.now(),
    };
    const updated = [entry, ...vault];
    setVault(updated);
    saveVault(updated);
    toast({ title: "Saved to Vault" });
  };

  const handleExport = (format: "md" | "txt") => {
    if (!currentResponse) return;
    const content = format === "md"
      ? formatResponseAsMarkdown(currentQuery, currentResponse, mode)
      : `IT Ops Console — ${mode.toUpperCase()}\nQuery: ${currentQuery}\n\n${currentResponse}`;
    const blob = new Blob([content], { type: format === "md" ? "text/markdown" : "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `itops-${mode}-${Date.now()}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyAll = async () => {
    if (!currentResponse) return;
    await navigator.clipboard.writeText(currentResponse);
    toast({ title: "Copied to clipboard" });
  };

  const loadVaultEntry = (entry: VaultEntry) => {
    setCurrentResponse(entry.response);
    setCurrentQuery(entry.query);
    setMode(entry.mode);
  };

  const modeConfig = MODES.find((m) => m.id === mode)!;

  return (
    <div className="flex h-full bg-zinc-950 text-zinc-100">
      <div className="w-48 shrink-0 border-r border-zinc-800 flex flex-col bg-zinc-950">
        <div className="px-3 py-3 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-emerald-400" />
            <span className="text-xs font-semibold text-zinc-200 uppercase tracking-wider">IT Ops</span>
          </div>
        </div>

        <div className="flex-1 py-2 px-2 space-y-0.5">
          {MODES.map((m) => {
            const Icon = m.icon;
            const active = mode === m.id;
            return (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                data-testid={`button-mode-${m.id}`}
                className={`
                  w-full flex items-center gap-2 px-2.5 py-2 rounded text-left transition-all
                  ${active
                    ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                    : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 border border-transparent"
                  }
                `}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <div className="min-w-0">
                  <div className="text-xs font-medium truncate">{m.label}</div>
                  {active && (
                    <div className="text-[10px] text-zinc-500 truncate mt-0.5">{m.desc}</div>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        <div className="border-t border-zinc-800 px-2 py-2 space-y-2">
          <button
            onClick={() => setShowVault(true)}
            className="w-full flex items-center gap-2 px-2.5 py-2 rounded text-left text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 transition-all"
            data-testid="button-open-vault"
          >
            <Archive className="w-3.5 h-3.5" />
            <span className="text-xs font-medium">Vault</span>
            {vault.length > 0 && (
              <span className="ml-auto text-[10px] text-zinc-600">{vault.length}</span>
            )}
          </button>

          {history.length > 0 && (
            <div>
              <div className="flex items-center justify-between px-1 mb-1">
                <span className="text-[10px] text-zinc-600 uppercase tracking-wider">Recent</span>
                <button
                  onClick={clearSession}
                  className="text-zinc-600 hover:text-zinc-400 transition-colors"
                  title="Clear"
                  data-testid="button-clear-session"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
              <div className="space-y-0.5 max-h-32 overflow-y-auto">
                {history.map((entry) => (
                  <button
                    key={entry.id}
                    onClick={() => { setCurrentResponse(entry.response); setCurrentQuery(entry.query); setMode(entry.mode); }}
                    data-testid={`button-history-${entry.id}`}
                    className="w-full text-left px-2 py-1.5 rounded text-[11px] text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 truncate transition-all"
                    title={entry.query}
                  >
                    {entry.query}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-zinc-900/50">
          <div className="flex items-center gap-2">
            <modeConfig.icon className="w-4 h-4 text-emerald-400" />
            <span className="text-sm font-medium text-zinc-200">{modeConfig.label}</span>
            <span className="text-[10px] text-zinc-600 hidden sm:inline">·</span>
            <span className="text-[10px] text-zinc-500 hidden sm:inline">{modeConfig.desc}</span>
          </div>

          {currentResponse && !isStreaming && (
            <div className="flex items-center gap-1">
              <button
                onClick={handleCopyAll}
                className="flex items-center gap-1 px-2 py-1 text-[10px] rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
                data-testid="button-copy-all"
              >
                <CopyPlus className="w-3 h-3" />
                <span className="hidden sm:inline">Copy All</span>
              </button>
              <button
                onClick={() => setShowSaveDialog(true)}
                className="flex items-center gap-1 px-2 py-1 text-[10px] rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
                data-testid="button-save-vault"
              >
                <BookmarkPlus className="w-3 h-3" />
                <span className="hidden sm:inline">Save</span>
              </button>
              <button
                onClick={() => handleExport("md")}
                className="flex items-center gap-1 px-2 py-1 text-[10px] rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
                data-testid="button-export-md"
              >
                <FileText className="w-3 h-3" />
                <span className="hidden sm:inline">.md</span>
              </button>
              <button
                onClick={() => handleExport("txt")}
                className="flex items-center gap-1 px-2 py-1 text-[10px] rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
                data-testid="button-export-txt"
              >
                <Download className="w-3 h-3" />
                <span className="hidden sm:inline">.txt</span>
              </button>
            </div>
          )}
        </div>

        <div ref={responseRef} className="flex-1 overflow-auto px-6 py-4">
          {!currentResponse && history.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="w-14 h-14 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mb-4">
                <modeConfig.icon className="w-7 h-7 text-emerald-400" />
              </div>
              <h2 className="text-lg font-semibold text-zinc-200 mb-1">
                {modeConfig.label}
              </h2>
              <p className="text-sm text-zinc-500 max-w-md mb-6">
                {modeConfig.desc}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs max-w-lg w-full">
                {getExamples(mode).map((ex, i) => (
                  <button
                    key={i}
                    onClick={() => { setQuery(ex); inputRef.current?.focus(); }}
                    data-testid={`button-example-${i}`}
                    className="text-left px-3 py-2.5 rounded border border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700 hover:bg-zinc-900/50 transition-all"
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          )}

          {currentResponse && (
            <div className="max-w-3xl">
              <ResponseBlock content={currentResponse} />
              {isStreaming && (
                <div className="flex items-center gap-2 mt-3 text-xs text-zinc-500">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>Processing...</span>
                </div>
              )}
            </div>
          )}

          {!currentResponse && history.length > 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="w-14 h-14 rounded-xl bg-zinc-800/50 border border-zinc-800 flex items-center justify-center mb-4">
                <modeConfig.icon className="w-7 h-7 text-zinc-500" />
              </div>
              <p className="text-sm text-zinc-500">Ready</p>
            </div>
          )}
        </div>

        <div className="border-t border-zinc-800 bg-zinc-900/50 px-4 py-3">
          <div className="max-w-3xl">
            <div className="flex items-end gap-2">
              <div className="flex-1 relative">
                <Textarea
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={getPlaceholder(mode)}
                  disabled={isStreaming}
                  rows={1}
                  data-testid="input-query"
                  className="resize-none bg-zinc-950 border-zinc-800 text-zinc-100 placeholder:text-zinc-600 text-sm font-mono min-h-[40px] max-h-[120px] focus-visible:ring-emerald-500/30 focus-visible:border-emerald-500/50"
                  style={{ fieldSizing: "content" } as any}
                />
              </div>
              <Button
                onClick={() => handleSubmit()}
                disabled={!query.trim() || isStreaming}
                size="sm"
                data-testid="button-submit-query"
                className="bg-emerald-600 hover:bg-emerald-500 text-white h-10 px-3"
              >
                {isStreaming ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </Button>
              {history.length > 0 && (
                <Button
                  onClick={handleReuseLast}
                  disabled={isStreaming}
                  variant="outline"
                  size="sm"
                  data-testid="button-reuse-last"
                  className="border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 h-10"
                  title="Run again"
                >
                  <RotateCcw className="w-4 h-4" />
                </Button>
              )}
            </div>
            <div className="flex items-center justify-between mt-1.5">
              <span className="text-[10px] text-zinc-600 font-mono">
                Enter to send · Shift+Enter for new line
              </span>
              <span className="text-[10px] text-zinc-600 font-mono">
                {modeConfig.label.toUpperCase()}
              </span>
            </div>
          </div>
        </div>
      </div>

      <VaultDialog
        open={showVault}
        onClose={() => setShowVault(false)}
        vault={vault}
        setVault={setVault}
        onLoad={loadVaultEntry}
      />
      <SaveDialog
        open={showSaveDialog}
        onClose={() => setShowSaveDialog(false)}
        onSave={handleSaveToVault}
      />
    </div>
  );
}

function getPlaceholder(mode: OpsMode): string {
  switch (mode) {
    case "quick-fix":
      return "Describe the issue...";
    case "script-builder":
      return "What script do you need?";
    case "deep-dive":
      return "Describe the symptoms...";
    case "network":
      return "Describe the network issue...";
    case "system-design":
      return "What are you designing?";
  }
}

function getExamples(mode: OpsMode): string[] {
  switch (mode) {
    case "quick-fix":
      return [
        "BSOD IRQL_NOT_LESS_OR_EQUAL after Windows update",
        "RDP disconnects after exactly 1 minute",
        "Exchange 365 mail flow stuck in queue",
        "GPO not applying to new OU",
      ];
    case "script-builder":
      return [
        "PowerShell: bulk disable inactive AD users (90 days)",
        "Bash: monitor disk space and alert via Slack",
        "Python: parse Windows Event Log for failed logins",
        "PowerShell: automated workstation inventory report",
      ];
    case "deep-dive":
      return [
        "Server intermittently unreachable, no pattern in logs",
        "SQL Server deadlocks occurring every 2 hours",
        "Hyper-V VM performance degraded after host migration",
        "WSUS clients not reporting for 30+ days",
      ];
    case "network":
      return [
        "High latency on VPN tunnel between sites",
        "DHCP exhaustion in /24 subnet",
        "Asymmetric routing after adding second WAN link",
        "802.1X authentication failing for specific VLANs",
      ];
    case "system-design":
      return [
        "DR plan for 200-user office with RTO < 4 hours",
        "Zero-trust network architecture for MSP client",
        "Migrate on-prem Exchange to M365 with hybrid coexistence",
        "Multi-tenant RMM monitoring stack design",
      ];
  }
}
