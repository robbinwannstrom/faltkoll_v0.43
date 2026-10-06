import React, { useRef, useState, useEffect } from 'react';
import { Project, UserAccount } from '../types';
import { getAllProjects, saveProject } from '../db/indexedDb';
import { StorageStatusWidget } from './StorageStatusWidget';
import { safeFetchJson } from '../services/apiHelper';
import {
  saveProjectToCloud,
  findProjectByCodeInFirestore,
  pushStudentProjectToCloud,
} from '../services/studentWorkService';
import { fetchExerciseByCode, convertExerciseToProject } from '../services/exerciseService';
import {
  Share2,
  Upload,
  Download,
  Users,
  CheckCircle2,
  X,
  FileCode,
  ShieldCheck,
  QrCode,
  Copy,
  Check,
  Cloud,
  RefreshCw,
  ArrowRight,
} from 'lucide-react';

interface CollaborationModalProps {
  project?: Project;
  onClose: () => void;
  onProjectImported?: (importedProject: Project) => void;
  onUpdateProject?: (updatedProject: Project) => void;
  currentUser?: UserAccount | null;
}

export const CollaborationModal: React.FC<CollaborationModalProps> = ({
  project,
  onClose,
  onProjectImported,
  onUpdateProject,
  currentUser,
}) => {
  const [copiedCode, setCopiedCode] = useState(false);
  const [joinCode, setJoinCode] = useState(() => {
    try {
      return localStorage.getItem('falthjalp_saved_group_code') || '';
    } catch {
      return '';
    }
  });
  const [customCode, setCustomCode] = useState(
    project?.groupCode || `KLASS-${project?.id.slice(-4).toUpperCase() || 'PROJ'}`
  );
  const [isEditingCode, setIsEditingCode] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [message, setMessage] = useState<{ text: string; isError?: boolean } | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (project?.groupCode) {
      setCustomCode(project.groupCode);
    }
  }, [project?.groupCode]);

  const currentCode = customCode.trim().toUpperCase();

  const handleCopyCode = () => {
    navigator.clipboard?.writeText(currentCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2500);
  };

  const handleSaveCustomGroupCode = async () => {
    const clean = customCode.trim().toUpperCase();
    if (!clean) return;
    setIsEditingCode(false);

    try {
      localStorage.setItem('falthjalp_saved_group_code', clean);
    } catch {}

    setCustomCode(clean);
    setJoinCode(clean);

    if (project) {
      const now = new Date().toISOString().replace('T', ' ').substring(0, 16);
      const updatedProj: Project = {
        ...project,
        groupCode: clean,
        isGroupProject: true,
        syncEnabled: true,
        updatedAt: now,
        lastSyncedAt: now,
      };

      await saveProject(updatedProj);
      if (onUpdateProject) {
        onUpdateProject(updatedProj);
      }
      // Instantly register to Firestore & Server simultaneously
      await Promise.allSettled([
        saveProjectToCloud(updatedProj),
        pushStudentProjectToCloud(updatedProj, currentUser),
      ]);

      setMessage({
        text: `✓ Egen gruppkod "${clean}" har sparats och registrerats för "${project.name}"! Kollegor och elever kan nu ansluta med denna kod.`,
        isError: false,
      });
    } else {
      const all = await getAllProjects(false);
      if (all.length > 0) {
        const top = all[0];
        top.groupCode = clean;
        top.isGroupProject = true;
        top.syncEnabled = true;
        await saveProject(top);
        await Promise.allSettled([
          saveProjectToCloud(top),
          pushStudentProjectToCloud(top, currentUser),
        ]);
        if (onUpdateProject) onUpdateProject(top);
        setMessage({
          text: `✓ Egen gruppkod "${clean}" har sparats för "${top.name}" och är nu aktiv!`,
          isError: false,
        });
      } else {
        setMessage({
          text: `✓ Egen gruppkod "${clean}" har sparats som standardkod för dina framtida projekt!`,
          isError: false,
        });
      }
    }
  };

  const handleJoinWithCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const codeToUse = joinCode.trim().toUpperCase();
    if (!codeToUse) return;

    try {
      setIsJoining(true);
      setMessage(null);

      // Save code in localStorage so user only needs to enter it once!
      try {
        localStorage.setItem('falthjalp_saved_group_code', codeToUse);
      } catch {}

      let foundProject: Project | null = null;

      // 1. Try server endpoint
      try {
        const res = await safeFetchJson<{ project: Project }>('/api/sync/join-code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: codeToUse }),
        });

        if (res.ok && res.data?.project) {
          foundProject = res.data.project;
        }
      } catch {}

      // 2. If server failed (e.g. static hosting, offline, or separate container), check Google Cloud Firestore directly!
      if (!foundProject) {
        try {
          foundProject = await findProjectByCodeInFirestore(codeToUse);
        } catch {}
      }

      // 3. If still not found, check if codeToUse is an exercise code (e.g. GRUND-1, PLATTA-2, AVLOPP-1)
      if (!foundProject) {
        try {
          const ex = await fetchExerciseByCode(codeToUse);
          if (ex) {
            foundProject = convertExerciseToProject(
              ex,
              currentUser?.displayName || 'Elev / Grupp',
              codeToUse
            );
            foundProject.groupCode = codeToUse;
            foundProject.isGroupProject = true;
            foundProject.syncEnabled = true;
            await saveProjectToCloud(foundProject);
          }
        } catch {}
      }

      // 4. Also check local IndexedDB
      if (!foundProject) {
        try {
          const allLocal = await getAllProjects(false);
          foundProject =
            allLocal.find(
              (p) =>
                (p.groupCode && p.groupCode.trim().toUpperCase() === codeToUse) ||
                (p.exerciseCode && p.exerciseCode.trim().toUpperCase() === codeToUse)
            ) || null;
        } catch {}
      }

      if (foundProject) {
        await saveProject(foundProject);
        setMessage({
          text: `✓ Projekt "${foundProject.name}" har anslutits framgångsrikt med kod "${codeToUse}"!`,
          isError: false,
        });
        if (onProjectImported) {
          setTimeout(() => {
            onProjectImported(foundProject!);
          }, 600);
        }
      } else {
        setMessage({
          text: `Hittade inget aktivt projekt eller övning med koden "${codeToUse}". Kontrollera att rätt kod angivits med din lärare eller kamrat.`,
          isError: true,
        });
      }
    } catch {
      setMessage({
        text: `Kunde inte ansluta med koden "${codeToUse}". Kontrollera anslutningen eller koden.`,
        isError: true,
      });
    } finally {
      setIsJoining(false);
    }
  };

  const handleSyncCurrentProject = async () => {
    if (!project) return;
    try {
      setIsSyncing(true);
      setMessage(null);

      const codeToSync = (customCode.trim() || project.groupCode || `KLASS-${project.id.slice(-4)}`).toUpperCase();
      try {
        localStorage.setItem('falthjalp_saved_group_code', codeToSync);
      } catch {}

      const now = new Date().toISOString().replace('T', ' ').substring(0, 16);
      const updatedProj: Project = {
        ...project,
        groupCode: codeToSync,
        isGroupProject: true,
        syncEnabled: true,
        updatedAt: now,
        lastSyncedAt: now,
      };

      await saveProject(updatedProj);
      if (onUpdateProject) {
        onUpdateProject(updatedProj);
      }
      // Save directly to Firestore and server simultaneously
      await Promise.allSettled([
        saveProjectToCloud(updatedProj),
        pushStudentProjectToCloud(updatedProj, currentUser),
      ]);

      setMessage({
        text: `✓ Projektet är synkat till molnet med kod "${codeToSync}"! Kollegor och elever kan ansluta direkt med denna kod.`,
        isError: false,
      });
    } catch (err: any) {
      setMessage({
        text: 'Sparat lokalt på enheten: ' + (err?.message || 'Offline'),
        isError: false,
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleExportProjectFile = () => {
    if (!project) return;
    const json = JSON.stringify(project, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${project.name.replace(/\s+/g, '_')}_Delning.faltkoll`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const imported = JSON.parse(text) as Project;
      if (!imported.id || !imported.moments) {
        throw new Error('Ogiltigt projektformat. Filen saknar moment eller projekt-ID.');
      }
      await saveProject(imported);
      setMessage({ text: `Projekt "${imported.name}" har importerats från fil!` });
      if (onProjectImported) {
        onProjectImported(imported);
      }
    } catch (err: any) {
      setMessage({ text: 'Kunde inte importera projekt: ' + (err?.message || 'Fel i filen'), isError: true });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/85 backdrop-blur-md overflow-y-auto text-slate-100"
    >
      <input
        type="file"
        ref={fileInputRef}
        accept=".json,.faltkoll"
        onChange={handleImportFile}
        className="hidden"
      />

      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[#12151e] border border-slate-700/80 rounded-2xl max-w-lg w-full p-5 sm:p-6 shadow-2xl space-y-5 my-auto max-h-[92vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-sky-500/15 border border-sky-500/30 text-sky-400 flex items-center justify-center font-bold">
              <Users className="w-5 h-5 stroke-[2.2]" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-bold text-white">
                Direktsynkning & Grupparbete
              </h3>
              <p className="text-xs text-slate-400">
                Synka kontroller, fältblock och foton direkt utan manuella filer
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center cursor-pointer transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Message notification */}
        {message && (
          <div
            className={`p-3 rounded-xl border text-xs sm:text-sm flex items-center gap-2 ${
              message.isError
                ? 'bg-rose-950/80 border-rose-700 text-rose-200'
                : 'bg-emerald-950/80 border-emerald-600 text-emerald-200'
            }`}
          >
            {message.isError ? (
              <X className="w-4 h-4 text-rose-400 shrink-0" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            )}
            <span>{message.text}</span>
          </div>
        )}

        {/* Section 1: Anslut med Gruppkod (Supersmidigt!) */}
        <div className="bg-slate-950 border border-slate-850 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-sky-400 uppercase tracking-wider flex items-center gap-1.5">
              <Cloud className="w-4 h-4" />
              1. Anslut till ett projekt med gruppkod
            </span>
          </div>

          <p className="text-xs text-slate-300">
            Har du fått en gruppkod av din lärare eller klasskamrat? Skriv in den här för att hämta projektet direkt till din telefon:
          </p>

          <form onSubmit={handleJoinWithCode} className="flex gap-2">
            <input
              type="text"
              required
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="T.ex. BYGG-4A"
              className="flex-1 min-h-[44px] px-3.5 bg-slate-900 border border-slate-700 focus:border-sky-400 rounded-xl text-white font-mono font-bold text-sm outline-none uppercase placeholder-slate-600"
            />
            <button
              type="submit"
              disabled={isJoining}
              className="min-h-[44px] px-4 bg-sky-500 hover:bg-sky-400 active:scale-95 text-slate-950 font-bold text-xs sm:text-sm rounded-xl flex items-center gap-1.5 cursor-pointer shadow-md transition-all shrink-0"
            >
              {isJoining ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <ArrowRight className="w-4 h-4" />
              )}
              <span>{isJoining ? 'Hämtar...' : 'Anslut nu'}</span>
            </button>
          </form>
        </div>

        {/* Section 2: Aktivt projekt & dela kod */}
        {project ? (
          <div className="bg-[#151926] border border-amber-500/30 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                <Share2 className="w-4 h-4" />
                2. Dela detta projekt ({project.name})
              </span>
            </div>

            <p className="text-xs text-slate-300">
              Välj en egen gruppkod nedan eller använd den föreslagna. Kollegor och elever ansluter med denna kod för att se samma kontroller och foton:
            </p>

            <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800 space-y-3">
              <div>
                <label className="text-xs font-bold text-amber-300 block mb-1.5">
                  Gruppkod för detta projekt (ändra och spara fritt):
                </label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={customCode}
                    onChange={(e) => {
                      const clean = e.target.value.toUpperCase();
                      setCustomCode(clean);
                    }}
                    placeholder="T.ex. BYGG-73, LAG-2 eller MINKOD"
                    className="flex-1 min-h-[42px] px-3.5 bg-slate-900 border border-amber-500/70 focus:border-amber-400 rounded-xl text-white font-mono text-sm font-bold uppercase outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleSaveCustomGroupCode}
                    className="min-h-[42px] px-4 bg-amber-500 hover:bg-amber-400 active:scale-95 text-slate-950 font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 cursor-pointer shadow-md transition-all shrink-0"
                  >
                    <Check className="w-4 h-4 stroke-[2.5]" />
                    <span>Spara kod</span>
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-850">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono font-bold text-amber-300 px-2.5 py-1 bg-amber-950/60 rounded-lg border border-amber-800">
                    {currentCode}
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyCode}
                    className="min-h-[34px] px-3 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-750 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors"
                  >
                    {copiedCode ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    <span>{copiedCode ? 'Kopierad!' : 'Kopiera kod'}</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleSyncCurrentProject}
                  disabled={isSyncing}
                  className="min-h-[36px] px-4 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-black font-black rounded-xl text-xs flex items-center gap-1.5 cursor-pointer shadow-md transition-all shrink-0"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                  <span>{isSyncing ? 'Synkar...' : 'Synka till molnet nu'}</span>
                </button>
              </div>

              <p className="text-[11px] text-slate-400 leading-relaxed">
                💡 Andra deltagare anger denna kod under <strong>"1. Anslut till ett projekt med gruppkod"</strong> eller i startfönstrets snabbruta. Alla uppdateringar synkas automatiskt mellan era telefoner.
              </p>
            </div>

            {project.lastSyncedAt && (
              <span className="text-[11px] text-slate-400 block font-mono">
                Senast synkad till molnet: {project.lastSyncedAt}
              </span>
            )}

            {/* Molnutrymmes-mätare och fyllnadsgrad */}
            <StorageStatusWidget />
          </div>
        ) : null}

        {/* Section 3: Reserv Fil-export & Import */}
        <div className="pt-1 border-t border-slate-800">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Offline-delning via fil:</span>
            <div className="flex items-center gap-2">
              {project && (
                <button
                  type="button"
                  onClick={handleExportProjectFile}
                  className="text-sky-400 hover:underline cursor-pointer"
                >
                  Exportera .faltkoll
                </button>
              )}
              <span>•</span>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="text-sky-400 hover:underline cursor-pointer"
              >
                Öppna fil
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end border-t border-slate-800 pt-3">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[38px] px-4 bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 font-bold rounded-xl cursor-pointer text-xs"
          >
            Klar
          </button>
        </div>
      </div>
    </div>
  );
};
