"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import Link from "next/link";

import { createClient } from "@/lib/supabase/client";

type JobStatus = "New match" | "Approved" | "Dismissed";
type View = "Overview" | "Applications" | "Profile & resume" | "Preferences";

type Job = {
  id: string;
  company: string;
  role: string;
  location: string;
  type: string;
  match: number;
  source: string;
  status: JobStatus;
  reason: string;
  url: string;
  description: string;
  createdAt: string;
};

type Profile = {
  name: string;
  title: string;
  location: string;
  email: string;
  linkedin: string;
  portfolio: string;
  keywords: string;
  resumeName: string;
  resumePath: string | null;
  emailNotifications: boolean;
  scansEnabled: boolean;
};

const initialProfile: Profile = {
  name: "",
  title: "",
  location: "",
  email: "",
  linkedin: "",
  portfolio: "",
  keywords: "",
  resumeName: "",
  resumePath: null,
  emailNotifications: false,
  scansEnabled: true,
};

type JobSource = {
  id: string;
  provider: "greenhouse" | "lever";
  board_slug: string;
  company_name: string;
  active: boolean;
};

function mapJob(row: Record<string, unknown>): Job {
  const status = row.status === "approved" ? "Approved" : row.status === "dismissed" ? "Dismissed" : "New match";
  return {
    id: String(row.id),
    company: String(row.company_name || ""),
    role: String(row.title || ""),
    location: String(row.location || "Location not specified"),
    type: String(row.employment_type || "Not specified"),
    match: Number(row.match_score || 0),
    source: "Company career board",
    status,
    reason: String(row.match_reason || ""),
    url: String(row.job_url || ""),
    description: String(row.description || ""),
    createdAt: String(row.created_at || ""),
  };
}

function timeAgo(date: string) {
  const elapsed = Math.max(0, Date.now() - new Date(date).getTime());
  const hours = Math.floor(elapsed / 3_600_000);
  if (hours < 1) return "Just found";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function Icon({
  name,
  size = 18,
}: {
  name: "grid" | "briefcase" | "user" | "sliders" | "bell" | "arrow" | "spark" | "clock" | "check" | "plus" | "external" | "menu" | "logout";
  size?: number;
}) {
  const paths: Record<typeof name, React.ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /></>,
    briefcase: <><rect x="3" y="7" width="18" height="14" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18M10 12v2h4v-2" /></>,
    user: <><circle cx="12" cy="8" r="4" /><path d="M5 21a7 7 0 0 1 14 0" /></>,
    sliders: <><path d="M4 21v-7m0-4V3m8 18v-9m0-4V3m8 18v-5m0-4V3M2 14h4m4-6h4m4 8h4" /></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12h4" /></>,
    arrow: <><path d="M7 17 17 7M7 7h10v10" /></>,
    spark: <><path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2L12 3Z" /><path d="m19 14 1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2Z" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    external: <><path d="M14 3h7v7m0-7L10 14" /><path d="M19 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6" /></>,
    menu: <><path d="M4 6h16M4 12h16M4 18h16" /></>,
    logout: <><path d="M10 17l5-5-5-5m5 5H3" /><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6" /></>,
  };

  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}

export default function Home() {
  const configured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
  const [authReady, setAuthReady] = useState(
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
  const [user, setUser] = useState<User | null>(null);
  const activeUserId = useRef<string | null>(null);
  const [loginEmail, setLoginEmail] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);
  const [activeView, setActiveView] = useState<View>("Overview");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [sources, setSources] = useState<JobSource[]>([]);
  const [sourceProvider, setSourceProvider] = useState<JobSource["provider"]>("greenhouse");
  const [sourceCompany, setSourceCompany] = useState("");
  const [sourceSlug, setSourceSlug] = useState("");
  const [profile, setProfile] = useState(initialProfile);
  const [profileOpen, setProfileOpen] = useState(false);
  const [integrationOpen, setIntegrationOpen] = useState(false);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [profileBusy, setProfileBusy] = useState(false);

  useEffect(() => {
    if (!configured) {
      return;
    }

    let active = true;
    const supabase = createClient();
    const acceptUser = (nextUser: User | null) => {
      if (activeUserId.current !== (nextUser?.id || null)) {
        setProfile({ ...initialProfile });
        setJobs([]);
        setSources([]);
        setSelectedJob(null);
        setProfileOpen(false);
        activeUserId.current = nextUser?.id || null;
      }
      setUser(nextUser);
      setDataLoading(Boolean(nextUser));
      setAuthReady(true);
    };
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) {
        acceptUser(session?.user || null);
      }
    });
    void supabase.auth.getUser().then(({ data, error }) => {
      if (!active) return;
      if (error) setNotice(`Could not check your sign-in: ${error.message}`);
      acceptUser(data.user);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [configured]);

  useEffect(() => {
    if (!user) {
      return;
    }

    let active = true;
    void Promise.all([
      fetch("/api/profile"),
      fetch("/api/matches"),
      fetch("/api/sources"),
    ]).then(async ([profileResponse, jobsResponse, sourcesResponse]) => {
      const [profileBody, jobsBody, sourcesBody] = await Promise.all([
        profileResponse.json(),
        jobsResponse.json(),
        sourcesResponse.json(),
      ]);
      if (!active) return;
      const failure = [profileResponse, jobsResponse, sourcesResponse].find((response) => !response.ok);
      if (failure) {
        const body = failure === profileResponse ? profileBody : failure === jobsResponse ? jobsBody : sourcesBody;
        throw new Error(body.error || "Could not load your account data.");
      }

      const saved = profileBody.profile;
      setProfile({
        ...initialProfile,
        email: profileBody.email || user.email || "",
        name: saved?.full_name || "",
        title: saved?.target_role || "",
        location: saved?.location || "",
        linkedin: saved?.linkedin_url || "",
        portfolio: saved?.portfolio_url || "",
        keywords: Array.isArray(saved?.keywords) ? saved.keywords.join(", ") : "",
        resumePath: saved?.resume_path || null,
        resumeName: saved?.resume_path?.split("/").at(-1)?.replace(/^[0-9a-f-]+-/, "") || "",
        emailNotifications: saved?.email_notifications || false,
        scansEnabled: saved?.scans_enabled ?? true,
      });
      setJobs((jobsBody.matches || []).map((job: Record<string, unknown>) => mapJob(job)));
      setSources(sourcesBody.sources || []);
    }).catch((error: unknown) => {
      if (active) {
        console.error("Could not load account data.", error);
        setNotice(error instanceof Error ? error.message : "Could not load your account data.");
      }
    }).finally(() => {
      if (active) setDataLoading(false);
    });

    return () => {
      active = false;
    };
  }, [user]);

  const pendingCount = useMemo(
    () => jobs.filter((job) => job.status === "New match").length,
    [jobs],
  );
  const profileReadiness = Math.round(
    ([profile.name, profile.title, profile.location, profile.keywords, profile.resumePath]
      .filter(Boolean).length / 5) * 100,
  );

  async function sendSignInLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthBusy(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOtp({
        email: loginEmail.trim(),
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) throw error;
      setNotice("Sign-in link sent. Check your inbox and verify your email.");
    } catch (error) {
      console.error("Could not send sign-in link.", error);
      setNotice(error instanceof Error ? error.message : "Could not send a sign-in link.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProfileBusy(true);
    try {
      const response = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: profile.name,
          targetRole: profile.title,
          location: profile.location,
          linkedinUrl: profile.linkedin,
          portfolioUrl: profile.portfolio,
          keywords: profile.keywords.split(/[,\n]/).map((value) => value.trim()).filter(Boolean),
          emailNotifications: profile.emailNotifications,
          scansEnabled: profile.scansEnabled,
          resumePath: profile.resumePath,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save your profile.");
      setProfileOpen(false);
      setNotice("Your profile is saved securely to your account.");
    } catch (error) {
      console.error("Could not save profile.", error);
      setNotice(error instanceof Error ? error.message : "Could not save your profile.");
    } finally {
      setProfileBusy(false);
    }
  }

  function updateProfile(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    const { name, value } = event.currentTarget;
    const checked = event.currentTarget instanceof HTMLInputElement && event.currentTarget.type === "checkbox"
      ? event.currentTarget.checked
      : value;
    setProfile((current) => ({ ...current, [name]: checked }));
  }

  async function selectResume(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file || !user) return;
    const allowedTypes = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];
    if (file.size > 5 * 1024 * 1024 || !allowedTypes.includes(file.type)) {
      setNotice("Choose a PDF or Word resume up to 5 MB.");
      event.currentTarget.value = "";
      return;
    }
    try {
      const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, "_").slice(-100);
      const path = `${user.id}/${crypto.randomUUID()}-${safeName}`;
      const { error } = await createClient().storage.from("resumes").upload(path, file, {
        contentType: file.type,
        upsert: false,
      });
      if (error) throw error;
      setProfile((current) => ({ ...current, resumeName: file.name, resumePath: path }));
      setNotice("Resume uploaded privately. Save your profile to finish.");
    } catch (error) {
      console.error("Could not upload resume.", error);
      setNotice(error instanceof Error ? error.message : "Could not upload your resume.");
    }
  }

  async function updateMatch(job: Job, status: "approved" | "dismissed") {
    try {
      const response = await fetch(`/api/matches/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not update this job.");
      setJobs((current) => current.map((item) => item.id === job.id
        ? { ...item, status: status === "approved" ? "Approved" : "Dismissed" }
        : item));
      setSelectedJob(null);
      setNotice(status === "approved"
        ? "Approval recorded. This preview does not submit applications."
        : "Job dismissed.");
    } catch (error) {
      console.error("Could not update job match.", error);
      setNotice(error instanceof Error ? error.message : "Could not update this job.");
    }
  }

  async function addSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const response = await fetch("/api/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: sourceProvider,
          boardSlug: sourceSlug.trim(),
          companyName: sourceCompany.trim(),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not add job source.");
      setSources((current) => [result.source, ...current]);
      setSourceCompany("");
      setSourceSlug("");
      setNotice("Job board added. It will be checked on the next scheduled scan.");
    } catch (error) {
      console.error("Could not add a job source.", error);
      setNotice(error instanceof Error ? error.message : "Could not add job source.");
    }
  }

  async function removeSource(sourceId: string) {
    try {
      const response = await fetch(`/api/sources/${sourceId}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not remove job source.");
      setSources((current) => current.filter((source) => source.id !== sourceId));
      setNotice("Job board removed.");
    } catch (error) {
      console.error("Could not remove job source.", error);
      setNotice(error instanceof Error ? error.message : "Could not remove job source.");
    }
  }

  async function sendTestNotification() {
    try {
      const response = await fetch("/api/notifications/test", { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not send test notification.");
      setNotice(`Test email sent to ${user?.email}.`);
    } catch (error) {
      console.error("Test notification failed.", error);
      setNotice(error instanceof Error ? error.message : "Could not send test notification.");
    }
  }

  async function signOut() {
    const { error } = await createClient().auth.signOut();
    if (error) {
      console.error("Could not sign out.", error);
      setNotice(error.message);
    }
  }

  const navItems: { label: View; icon: Parameters<typeof Icon>[0]["name"] }[] = [
    { label: "Overview", icon: "grid" },
    { label: "Applications", icon: "briefcase" },
    { label: "Profile & resume", icon: "user" },
    { label: "Preferences", icon: "sliders" },
  ];

  const visibleJobs = (activeView === "Applications"
    ? jobs
    : jobs.filter((job) => job.status === "New match")
  ).filter((job) => job.status !== "Dismissed");

  if (!authReady) {
    return <main className="auth-page"><div className="auth-card"><span className="brand-mark"><Icon name="spark" size={20} /></span><h1>Loading your secure workspace…</h1></div></main>;
  }

  if (!user) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <Link className="brand auth-brand" href="/"><span className="brand-mark"><Icon name="spark" size={20} /></span><span>jobpilot<span className="brand-period">.</span></span></Link>
          <div className="eyebrow">YOUR NEXT CHAPTER STARTS HERE</div>
          <h1>{configured ? "Your search, in your hands." : "One step away from your live workspace."}</h1>
          <p>{configured
            ? "Sign in with a secure email link. Your resume and search profile stay private to your account."
            : "Configure Supabase sign-in to enable secure profiles, real job-board scans, and email alerts."}</p>
          {configured ? (
            <form className="auth-form" onSubmit={sendSignInLink}>
              <label htmlFor="login-email">Email address</label>
              <input id="login-email" type="email" autoComplete="email" required value={loginEmail} onChange={(event) => setLoginEmail(event.currentTarget.value)} placeholder="you@example.com" />
              <button className="button button-dark" type="submit" disabled={authBusy}>{authBusy ? "Sending…" : "Email me a sign-in link"}</button>
              <small>We’ll send a one-time sign-in link. Verify your email before alerts can be enabled.</small>
            </form>
          ) : (
            <div className="setup-callout"><strong>Required to launch</strong><span>Supabase URL and publishable key, Resend API key and verified sender, plus Vercel environment configuration.</span></div>
          )}
          <div className="auth-privacy"><Icon name="check" size={16} /><span>No application is submitted without your explicit review.</span></div>
        </section>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileMenuOpen ? "sidebar-open" : ""}`}>
        <a className="brand" href="#" onClick={() => setActiveView("Overview")}>
          <span className="brand-mark"><Icon name="spark" size={20} /></span>
          <span>jobpilot<span className="brand-period">.</span></span>
        </a>

        <div className="workspace-label">WORKSPACE</div>
        <nav className="main-nav" aria-label="Main navigation">
          {navItems.map((item) => (
            <button
              className={`nav-item ${activeView === item.label ? "nav-item-active" : ""}`}
              key={item.label}
              onClick={() => {
                setMobileMenuOpen(false);
                if (item.label === "Profile & resume") {
                  setProfileOpen(true);
                  return;
                }
                setActiveView(item.label);
              }}
            >
              <Icon name={item.icon} size={18} />
              <span>{item.label}</span>
              {item.label === "Applications" && <span className="nav-count">{pendingCount}</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="sidebar-help">
            <div className="help-icon"><Icon name="spark" size={18} /></div>
            <strong>Your next move, made easier.</strong>
            <p>Good matches, thoughtful applications, all in one place.</p>
            <button onClick={() => setIntegrationOpen(true)}>Explore setup <Icon name="arrow" size={14} /></button>
          </div>
          <button className="profile-chip" onClick={() => setProfileOpen(true)}>
            <span className="avatar">{profile.name ? profile.name.charAt(0).toUpperCase() : "Y"}</span>
            <span className="profile-chip-copy"><strong>{profile.name || user.email || "Your profile"}</strong><small>{profile.title || "Add your details"}</small></span>
            <span className="profile-more">···</span>
          </button>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <button className="mobile-menu" aria-label="Open navigation" onClick={() => setMobileMenuOpen((open) => !open)}><Icon name="menu" /></button>
          <div className="breadcrumb"><span>Workspace</span><span className="crumb-slash">/</span><strong>{activeView}</strong></div>
          <div className="topbar-actions">
            <span className="preview-pill connected-pill"><span /> Secure account</span>
            <button className="icon-button notification-button" aria-label="Send a test email notification" onClick={sendTestNotification}><Icon name="bell" size={18} /><i /></button>
            <button className="top-avatar" aria-label="Edit profile" onClick={() => setProfileOpen(true)}>{profile.name ? profile.name.charAt(0).toUpperCase() : "Y"}</button>
            <button className="icon-button signout-button" aria-label="Sign out" onClick={signOut}><Icon name="logout" size={17} /></button>
          </div>
        </header>

        <div className="content-wrap">
          <div className="integration-banner">
            <span className="banner-dot" />
            <p><strong>Private account.</strong> Matches appear from your configured job boards after scheduled scanning is deployed. Review every role before taking action.</p>
            <button onClick={() => setIntegrationOpen(true)}>See what’s needed <Icon name="arrow" size={14} /></button>
          </div>

          {activeView === "Preferences" ? (
            <section className="preferences-panel">
              <div className="eyebrow">PERSONALIZE YOUR SEARCH</div>
              <h1>Preferences</h1>
              <p>Set your search criteria and decide whether scheduled scans and email alerts are active.</p>
              <div className="preference-card">
                <div><span className="preference-icon"><Icon name="sliders" /></span><div><h2>Job search profile</h2><p>Role, location, and skills used to find relevant opportunities.</p></div></div>
                <button className="button button-outline" onClick={() => setProfileOpen(true)}>Edit profile</button>
              </div>
              <div className="preference-card">
              <div><span className="preference-icon"><Icon name="clock" /></span><div><h2>Scan schedule</h2><p>GitHub Actions triggers scans every 30 minutes after secrets are configured.</p></div></div>
                <span className={`status-tag ${profile.scansEnabled ? "status-approved" : "status-paused"}`}>{profile.scansEnabled ? "Enabled" : "Paused"}</span>
              </div>
              <div className="preference-card">
                <div><span className="preference-icon"><Icon name="bell" /></span><div><h2>Email notifications</h2><p>New matches are emailed to your verified sign-in address: {user.email}</p></div></div>
                <span className={`status-tag ${profile.emailNotifications ? "status-approved" : "status-paused"}`}>{profile.emailNotifications ? "Enabled" : "Disabled"}</span>
              </div>
              <div className="preference-actions">
                <button className="button button-outline" onClick={sendTestNotification}>Send test email</button>
                <button className="button button-dark" onClick={() => setProfileOpen(true)}>Manage alerts and scans</button>
              </div>
              <div className="source-manager">
                <div className="source-heading"><div><h2>Job-board sources</h2><p>Add Greenhouse or Lever board slugs from company career pages. Up to 10 sources.</p></div><span className="count-badge">{sources.length}/10</span></div>
                <form className="source-form" onSubmit={addSource}>
                  <label>Platform<select value={sourceProvider} onChange={(event) => setSourceProvider(event.currentTarget.value as JobSource["provider"])}><option value="greenhouse">Greenhouse</option><option value="lever">Lever</option></select></label>
                  <label>Company name<input value={sourceCompany} onChange={(event) => setSourceCompany(event.currentTarget.value)} maxLength={120} required placeholder="Example, Inc." /></label>
                  <label>Board slug<input value={sourceSlug} onChange={(event) => setSourceSlug(event.currentTarget.value)} pattern="[A-Za-z0-9_-]{1,100}" required placeholder="company-name" /></label>
                  <button className="button button-dark" type="submit" disabled={sources.length >= 10}>Add source</button>
                </form>
                {sources.length ? <ul className="source-list">{sources.map((source) => <li key={source.id}><span className="source-status-dot" /><span><strong>{source.company_name}</strong><small>{source.provider} · {source.board_slug}</small></span><button className="text-button" onClick={() => removeSource(source.id)}>Remove</button></li>)}</ul> : <div className="source-empty">No job boards yet. Add a company&apos;s Greenhouse or Lever board to start scanning.</div>}
              </div>
            </section>
          ) : (
            <>
              <section className="welcome-row">
                <div>
                  <div className="eyebrow">YOUR JOB SEARCH</div>
                  <h1>{activeView === "Applications" ? "Your applications" : "A clearer path to your next role."}</h1>
                  <p>{activeView === "Applications" ? "Review every opportunity in one place. Nothing gets submitted without your approval." : "A little progress today can lead somewhere great."}</p>
                </div>
                <button className="button button-dark" onClick={() => setProfileOpen(true)}><Icon name="plus" size={17} /> Update my profile</button>
              </section>

              <section className="stats-grid" aria-label="Application overview">
                <article className="stat-card">
                  <div className="stat-top"><span>Strong matches</span><span className="stat-icon mint"><Icon name="spark" size={17} /></span></div>
                  <div className="stat-value">{jobs.filter((job) => job.match >= 75 && job.status !== "Dismissed").length}<span className="stat-trend">From your saved boards</span></div>
                  <div className="stat-foot">Roles that fit your profile</div>
                </article>
                <article className="stat-card">
                  <div className="stat-top"><span>Need your attention</span><span className="stat-icon peach"><Icon name="bell" size={17} /></span></div>
                  <div className="stat-value">{pendingCount}<span className="stat-trend attention-trend">Ready when you are</span></div>
                  <div className="stat-foot">New matches waiting for your review</div>
                </article>
                <article className="stat-card">
                  <div className="stat-top"><span>Applications approved</span><span className="stat-icon blue"><Icon name="check" size={17} /></span></div>
                  <div className="stat-value">{jobs.filter((job) => job.status === "Approved").length}<span className="stat-trend">Your decision</span></div>
                  <div className="stat-foot">Approvals are recorded, not submitted</div>
                </article>
              </section>

              <section className="jobs-section">
                <div className="section-heading">
                  <div>
                    <div className="section-title-row"><h2>{activeView === "Applications" ? "All opportunities" : "Picked for you"}</h2><span className="count-badge">{visibleJobs.length}</span></div>
                    <p>New roles from your saved company career boards.</p>
                  </div>
                  <button className="text-button" onClick={() => setActiveView("Applications")}>View all <Icon name="arrow" size={15} /></button>
                </div>

                <div className="job-list">
                  {visibleJobs.map((job) => (
                    <article className="job-card" key={job.id}>
                      <div className="company-logo logo-paper">{job.company.slice(0, 1).toUpperCase()}</div>
                      <div className="job-main">
                        <div className="job-title-row"><h3>{job.role}</h3><span className={`match-pill ${job.match >= 90 ? "match-high" : ""}`}><Icon name="spark" size={13} /> {job.match}% match</span></div>
                        <div className="company-line">{job.company}<span>·</span>{job.location}<span>·</span>{job.type}</div>
                        <div className="job-meta"><span>{job.source}</span><span className="meta-dot">·</span><span>{timeAgo(job.createdAt)}</span><span className={`status-tag ${job.status === "Approved" ? "status-approved" : "status-new"}`}>{job.status}</span></div>
                      </div>
                      <div className="job-actions">
                        <button className="button button-outline job-action" onClick={() => setSelectedJob(job)}>{job.status === "Approved" ? "View review" : "Review match"}</button>
                        <a className="icon-button external-button" aria-label={`Open ${job.company} role`} href={job.url} target="_blank" rel="noopener noreferrer"><Icon name="arrow" size={16} /></a>
                      </div>
                    </article>
                  ))}
                  {visibleJobs.length === 0 && <div className="empty-state"><span className="empty-icon"><Icon name={dataLoading ? "clock" : "check"} size={22} /></span><h3>{dataLoading ? "Loading your matches" : "No new matches yet"}</h3><p>{dataLoading ? "Loading your account data." : sources.length ? "Matches appear after the scheduled job-board service is deployed." : "Add a Greenhouse or Lever board in Preferences to begin."}</p>{!sources.length && <button className="text-button" onClick={() => setActiveView("Preferences")}>Add job boards <Icon name="arrow" size={15} /></button>}</div>}
                </div>
                <div className="list-footer"><span>Showing {visibleJobs.length} opportunities · {sources.length} boards connected</span><button onClick={() => setActiveView("Preferences")}>Manage sources <Icon name="arrow" size={14} /></button></div>
              </section>

              <section className="bottom-grid">
                <article className="schedule-card">
                  <div className="schedule-icon"><Icon name="clock" size={19} /></div>
                  <div className="schedule-copy"><span className="eyebrow">YOUR JOB SCAN</span><h3>Every 30 minutes</h3><p>{sources.length ? "Your company boards are included once the scheduled service is deployed." : "Add company career boards to start finding fresh roles."}</p></div>
                  <span className={`schedule-state ${profile.scansEnabled ? "schedule-on" : ""}`}><span /> {profile.scansEnabled ? "Enabled" : "Paused"}</span>
                </article>
                <article className="profile-progress">
                  <div className="progress-copy"><div className="eyebrow">PROFILE READINESS</div><h3>{profile.name ? "Your profile is taking shape" : "Start with your story"}</h3><p>{profile.name ? "Add keywords and a resume for more relevant matches." : "Add a target role and skills to begin matching."}</p><button className="text-button" onClick={() => setProfileOpen(true)}>{profile.name ? "Complete profile" : "Build your profile"} <Icon name="arrow" size={15} /></button></div>
                  <div className="progress-ring" style={{ "--progress": `${profileReadiness}%` } as React.CSSProperties}><span>{profileReadiness}%</span></div>
                </article>
              </section>
            </>
          )}

          <footer className="page-footer"><span>Made for your next chapter.</span><span>Private by design <i /> Nothing is submitted without your approval.</span></footer>
        </div>
      </main>

      {notice && <div className="toast" role="status"><Icon name="check" size={17} /><span>{notice}</span><button aria-label="Dismiss notification" onClick={() => setNotice("")}>×</button></div>}

      {profileOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setProfileOpen(false); }}>
          <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="profile-modal-title">
            <div className="modal-top"><span className="modal-icon"><Icon name="user" /></span><button className="modal-close" aria-label="Close" onClick={() => setProfileOpen(false)}>×</button></div>
            <div className="eyebrow">YOUR CAREER, YOUR TERMS</div><h2 id="profile-modal-title">Your profile</h2><p className="modal-intro">Your profile is stored privately in your account. We only send it to external services when necessary for the features you enable.</p>
            <form className="profile-form" onSubmit={saveProfile}>
              <label>Full name<input name="name" value={profile.name} onChange={updateProfile} placeholder="e.g. Alex Morgan" autoComplete="name" /></label>
              <label>Target role<input name="title" value={profile.title} onChange={updateProfile} placeholder="e.g. Product Designer" /></label>
              <div className="form-row"><label>Preferred location<input name="location" value={profile.location} onChange={updateProfile} placeholder="Remote, New York..." /></label><label>Verified account email<input value={user.email || ""} readOnly aria-readonly="true" /></label></div>
              <div className="form-row"><label>LinkedIn profile<input name="linkedin" type="url" value={profile.linkedin} onChange={updateProfile} placeholder="https://linkedin.com/in/you" /></label><label>Portfolio or website<input name="portfolio" type="url" value={profile.portfolio} onChange={updateProfile} placeholder="https://your-site.com" /></label></div>
              <label>Skills and keywords<textarea name="keywords" value={profile.keywords} onChange={updateProfile} placeholder="Separate skills, industries, or keywords with commas" rows={3} /></label>
              <label className="file-upload"><span className="upload-symbol">↑</span><span><strong>{profile.resumeName || "Upload your resume"}</strong><small>Private PDF or Word file · maximum 5 MB</small></span><input type="file" accept=".pdf,.doc,.docx" onChange={selectResume} /></label>
              <label className="setting-toggle"><input type="checkbox" name="scansEnabled" checked={profile.scansEnabled} onChange={updateProfile} /><span><strong>Enable scheduled scans</strong><small>Check your saved boards every 30 minutes.</small></span></label>
              <label className="setting-toggle"><input type="checkbox" name="emailNotifications" checked={profile.emailNotifications} onChange={updateProfile} /><span><strong>Email me new job matches</strong><small>Alerts go to your verified sign-in email, {user.email}.</small></span></label>
              <div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setProfileOpen(false)}>Cancel</button><button type="submit" className="button button-dark" disabled={profileBusy}>{profileBusy ? "Saving…" : "Save profile"}</button></div>
            </form>
          </section>
        </div>
      )}

      {integrationOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setIntegrationOpen(false); }}>
          <section className="modal-card integration-modal" role="dialog" aria-modal="true" aria-labelledby="integration-modal-title">
            <div className="modal-top"><span className="modal-icon"><Icon name="spark" /></span><button className="modal-close" aria-label="Close" onClick={() => setIntegrationOpen(false)}>×</button></div>
            <div className="eyebrow">LIVE SERVICE STATUS</div><h2 id="integration-modal-title">Your live setup</h2><p className="modal-intro">Your sign-in and private profile are active. Scheduled matching requires your Vercel deployment, migration, and service environment to be configured.</p>
            <div className="integration-list">
              <div><span className="integration-number">01</span><div><strong>Secure account and profile</strong><p>Your account is signed in. Profile and board access are restricted by database row-level security.</p></div><span className="status-tag status-approved">Connected</span></div>
              <div><span className="integration-number">02</span><div><strong>Job sources</strong><p>Configured boards: {sources.length}. Greenhouse and Lever public boards are supported.</p></div><span className={`status-tag ${sources.length ? "status-approved" : "status-paused"}`}>{sources.length ? "Connected" : "Add a board"}</span></div>
              <div><span className="integration-number">03</span><div><strong>Email notifications</strong><p>Destination: your verified sign-in address. Send a test message to validate delivery.</p></div><button className="button button-outline" onClick={sendTestNotification}>Test email</button></div>
              <div><span className="integration-number">04</span><div><strong>Scheduled checks and review</strong><p>GitHub Actions is configured to trigger scans every 30 minutes. Applications are never automatically submitted.</p></div><span className="status-tag status-paused">After repository setup</span></div>
            </div>
            <div className="privacy-note"><Icon name="check" size={16} /><span>Your resume is stored in a private bucket and is accessible only to your signed-in account.</span></div>
            <div className="modal-actions"><button className="button button-quiet" onClick={() => setIntegrationOpen(false)}>Close</button><button className="button button-dark" onClick={() => { setIntegrationOpen(false); setActiveView("Preferences"); }}>Manage sources</button></div>
          </section>
        </div>
      )}

      {selectedJob && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedJob(null); }}>
          <section className="modal-card review-modal" role="dialog" aria-modal="true" aria-labelledby="job-modal-title">
            <div className="modal-top"><span className="company-logo logo-paper">{selectedJob.company.slice(0, 1).toUpperCase()}</span><button className="modal-close" aria-label="Close" onClick={() => setSelectedJob(null)}>×</button></div>
            <div className="eyebrow">{selectedJob.company} · {selectedJob.source}</div><h2 id="job-modal-title">{selectedJob.role}</h2><p className="modal-intro">{selectedJob.location} · {selectedJob.type}</p>
            <div className="review-match"><span><Icon name="spark" size={16} /> {selectedJob.match}% profile match</span><p>{selectedJob.reason}</p></div>
            {selectedJob.description && <div className="job-description">{selectedJob.description}</div>}
            <a className="text-button job-link" href={selectedJob.url} target="_blank" rel="noopener noreferrer">Read the employer listing <Icon name="external" size={14} /></a>
            <div className="review-warning"><Icon name="bell" size={17} /><span>Approving only records your decision. It does not submit an application or contact the employer.</span></div>
            <div className="modal-actions">{selectedJob.status !== "Approved" && <><button className="button button-quiet" onClick={() => updateMatch(selectedJob, "dismissed")}>Dismiss</button><button className="button button-quiet" onClick={() => setSelectedJob(null)}>Not now</button><button className="button button-dark" onClick={() => updateMatch(selectedJob, "approved")}>Approve match</button></>}{selectedJob.status === "Approved" && <button className="button button-dark" onClick={() => setSelectedJob(null)}>Done</button>}</div>
          </section>
        </div>
      )}
    </div>
  );
}
