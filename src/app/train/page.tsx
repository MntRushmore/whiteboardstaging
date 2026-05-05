"use client";

import {
  Tldraw,
  useEditor,
  DefaultColorThemePalette,
  type TLShapeId,
  getSnapshot,
} from "tldraw";
import "tldraw/tldraw.css";
import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ArrowLeft, Lock, Save, RotateCcw, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/components/AuthProvider";
import { supabase } from "@/lib/supabase";

const TRAINER_EMAIL = "rushilchopra123@gmail.com";
const STORAGE_BUCKET = "training-data";

DefaultColorThemePalette.lightMode.background = "#FFFFFF";
DefaultColorThemePalette.darkMode.background = "#FFFFFF";

type Subject = "math" | "chemistry" | "physics" | "biology" | "other";
type Mode = "feedback" | "suggest" | "answer";
type Difficulty = "easy" | "medium" | "hard";
type Phase = "problem" | "solution";

const SUBJECTS: { value: Subject; label: string }[] = [
  { value: "math", label: "Math" },
  { value: "chemistry", label: "Chemistry" },
  { value: "physics", label: "Physics" },
  { value: "biology", label: "Biology" },
  { value: "other", label: "Other" },
];

const MODES: { value: Mode; label: string; hint: string }[] = [
  { value: "feedback", label: "Feedback", hint: "Light annotations on mistakes" },
  { value: "suggest", label: "Suggest", hint: "Hints, partial steps" },
  { value: "answer", label: "Answer", hint: "Full worked solution" },
];

const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];

function blobToFile(blob: Blob, name: string): File {
  return new File([blob], name, { type: blob.type });
}

function TrainContent({
  trainerEmail,
  trainerId,
}: {
  trainerEmail: string;
  trainerId: string;
}) {
  const editor = useEditor();
  const router = useRouter();

  const [subject, setSubject] = useState<Subject>("math");
  const [mode, setMode] = useState<Mode>("suggest");
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [topic, setTopic] = useState("");
  const [notes, setNotes] = useState("");

  const [phase, setPhase] = useState<Phase>("problem");
  const [problemShapeIds, setProblemShapeIds] = useState<TLShapeId[]>([]);
  const [problemSnapshotPng, setProblemSnapshotPng] = useState<Blob | null>(null);

  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState<number>(0);
  const initialCountLoaded = useRef(false);

  // Load lifetime count for this trainer
  useEffect(() => {
    if (initialCountLoaded.current) return;
    initialCountLoaded.current = true;
    (async () => {
      const { count } = await supabase
        .from("training_samples")
        .select("*", { count: "exact", head: true })
        .eq("created_by", trainerId);
      if (typeof count === "number") setSavedCount(count);
    })();
  }, [trainerId]);

  const captureCurrentCanvas = useCallback(
    async (shapeIds?: TLShapeId[]): Promise<Blob | null> => {
      if (!editor) return null;
      const ids = shapeIds ?? [...editor.getCurrentPageShapeIds()];
      if (ids.length === 0) return null;
      const bounds = editor.getViewportPageBounds();
      const { blob } = await editor.toImage(ids, {
        format: "png",
        bounds,
        background: true,
        scale: 1,
        padding: 0,
      });
      return blob ?? null;
    },
    [editor],
  );

  const handleLockProblem = useCallback(async () => {
    if (!editor) return;
    const ids = [...editor.getCurrentPageShapeIds()];
    if (ids.length === 0) {
      toast.error("Draw the problem first.");
      return;
    }
    const blob = await captureCurrentCanvas(ids);
    if (!blob) {
      toast.error("Couldn't capture the problem image.");
      return;
    }
    setProblemShapeIds(ids);
    setProblemSnapshotPng(blob);
    setPhase("solution");
    toast.success("Problem locked. Now draw the solution.");
  }, [editor, captureCurrentCanvas]);

  const resetSession = useCallback(() => {
    if (!editor) return;
    const allIds = [...editor.getCurrentPageShapeIds()];
    if (allIds.length > 0) {
      editor.deleteShapes(allIds);
    }
    setProblemShapeIds([]);
    setProblemSnapshotPng(null);
    setPhase("problem");
    setNotes("");
    setTopic("");
  }, [editor]);

  const handleSave = useCallback(async () => {
    if (!editor) return;
    if (phase !== "solution" || !problemSnapshotPng) {
      toast.error("Lock the problem first.");
      return;
    }

    const allIds = [...editor.getCurrentPageShapeIds()];
    const newShapeIds = allIds.filter((id) => !problemShapeIds.includes(id));
    if (newShapeIds.length === 0) {
      toast.error("Add solution strokes before saving.");
      return;
    }

    setSaving(true);
    try {
      const afterFullBlob = await captureCurrentCanvas(allIds);
      if (!afterFullBlob) throw new Error("Failed to capture after image");

      const sampleId = crypto.randomUUID();
      const basePath = `${trainerId}/${sampleId}`;
      const beforePath = `${basePath}/before.png`;
      const afterFullPath = `${basePath}/after_full.png`;

      const beforeUpload = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(beforePath, blobToFile(problemSnapshotPng, "before.png"), {
          contentType: "image/png",
          upsert: false,
        });
      if (beforeUpload.error) throw beforeUpload.error;

      const afterUpload = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(afterFullPath, blobToFile(afterFullBlob, "after_full.png"), {
          contentType: "image/png",
          upsert: false,
        });
      if (afterUpload.error) throw afterUpload.error;

      const snapshot = JSON.parse(JSON.stringify(getSnapshot(editor.store)));

      const { error: insertError } = await supabase
        .from("training_samples")
        .insert({
          id: sampleId,
          created_by: trainerId,
          created_by_email: trainerEmail,
          subject,
          topic: topic.trim() || null,
          difficulty,
          mode,
          notes: notes.trim() || null,
          before_url: beforePath,
          after_full_url: afterFullPath,
          tldraw_snapshot: snapshot,
          status: "pending",
          schema_version: 1,
        });
      if (insertError) throw insertError;

      setSavedCount((c) => c + 1);
      toast.success("Sample saved. Canvas cleared for next one.");
      resetSession();
    } catch (e) {
      console.error("Save sample failed:", e);
      toast.error(
        `Save failed: ${e instanceof Error ? e.message : "Unknown error"}`,
      );
    } finally {
      setSaving(false);
    }
  }, [
    editor,
    phase,
    problemSnapshotPng,
    problemShapeIds,
    captureCurrentCanvas,
    trainerId,
    trainerEmail,
    subject,
    topic,
    difficulty,
    mode,
    notes,
    resetSession,
  ]);

  return (
    <>
      {/* Top bar */}
      <div
        style={{
          position: "absolute",
          top: 16,
          left: 16,
          zIndex: 1000,
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <Button variant="ghost" size="icon" onClick={() => router.push("/")}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white border shadow-sm text-sm font-medium">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          Training Facility
        </div>
        <div className="px-3 py-1.5 rounded-full bg-white border shadow-sm text-xs text-gray-600">
          Saved: <span className="font-mono font-semibold">{savedCount}</span>
        </div>
      </div>

      {/* Phase banner */}
      <div
        style={{
          position: "absolute",
          top: 16,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 1000,
        }}
        className={`px-4 py-2 rounded-full text-sm font-semibold border shadow-sm ${
          phase === "problem"
            ? "bg-amber-50 border-amber-200 text-amber-800"
            : "bg-emerald-50 border-emerald-200 text-emerald-800"
        }`}
      >
        {phase === "problem"
          ? "Step 1 — Draw the problem"
          : "Step 2 — Draw the ideal solution / annotations"}
      </div>

      {/* Side panel */}
      <div
        style={{
          position: "absolute",
          top: 64,
          right: 16,
          bottom: 16,
          width: 320,
          zIndex: 1000,
        }}
        className="bg-white border rounded-lg shadow-md flex flex-col overflow-hidden"
      >
        <div className="p-4 border-b">
          <h2 className="font-semibold text-sm">Sample metadata</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Required before saving.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div>
            <Label className="text-xs">Subject</Label>
            <div className="grid grid-cols-3 gap-1 mt-1">
              {SUBJECTS.map((s) => (
                <button
                  key={s.value}
                  onClick={() => setSubject(s.value)}
                  className={`px-2 py-1.5 rounded-md text-xs border ${
                    subject === s.value
                      ? "bg-black text-white border-black"
                      : "bg-white hover:bg-gray-50"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label className="text-xs">Mode (target output type)</Label>
            <div className="space-y-1 mt-1">
              {MODES.map((m) => (
                <button
                  key={m.value}
                  onClick={() => setMode(m.value)}
                  className={`w-full text-left px-2 py-1.5 rounded-md text-xs border ${
                    mode === m.value
                      ? "bg-black text-white border-black"
                      : "bg-white hover:bg-gray-50"
                  }`}
                >
                  <div className="font-medium">{m.label}</div>
                  <div
                    className={`text-[10px] ${
                      mode === m.value ? "text-gray-300" : "text-gray-500"
                    }`}
                  >
                    {m.hint}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label className="text-xs">Difficulty</Label>
            <div className="grid grid-cols-3 gap-1 mt-1">
              {DIFFICULTIES.map((d) => (
                <button
                  key={d}
                  onClick={() => setDifficulty(d)}
                  className={`px-2 py-1.5 rounded-md text-xs border capitalize ${
                    difficulty === d
                      ? "bg-black text-white border-black"
                      : "bg-white hover:bg-gray-50"
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label htmlFor="topic" className="text-xs">
              Topic (optional)
            </Label>
            <Input
              id="topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g. quadratic equations"
              className="mt-1 h-8 text-xs"
            />
          </div>

          <div>
            <Label htmlFor="notes" className="text-xs">
              Notes (optional)
            </Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything special about this sample"
              rows={3}
              className="mt-1 text-xs"
            />
          </div>
        </div>

        <div className="p-4 border-t space-y-2 bg-gray-50">
          {phase === "problem" ? (
            <Button
              onClick={handleLockProblem}
              className="w-full"
              disabled={saving}
            >
              <Lock className="w-4 h-4 mr-2" />
              Lock problem
            </Button>
          ) : (
            <>
              <Button
                onClick={handleSave}
                className="w-full"
                disabled={saving}
              >
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4 mr-2" />
                    Save sample
                  </>
                )}
              </Button>
              <Button
                onClick={resetSession}
                variant="outline"
                className="w-full"
                disabled={saving}
              >
                <RotateCcw className="w-4 h-4 mr-2" />
                Discard & restart
              </Button>
            </>
          )}
          <p className="text-[10px] text-gray-500 text-center pt-1">
            Signed in as {trainerEmail}
          </p>
        </div>
      </div>
    </>
  );
}

export default function TrainPage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    if (user.email !== TRAINER_EMAIL) {
      router.replace("/");
    }
  }, [user, loading, router]);

  if (loading || !user) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (user.email !== TRAINER_EMAIL) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <Check className="w-8 h-8 mx-auto text-gray-400 mb-2" />
          <p className="text-gray-600">Redirecting…</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <Tldraw
        licenseKey={process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY}
        components={{
          MenuPanel: null,
          NavigationPanel: null,
          HelperButtons: null,
        }}
      >
        <TrainContent trainerEmail={user.email!} trainerId={user.id} />
      </Tldraw>
    </div>
  );
}
