// One realistic org, TESTORG, in the exact shapes production stores (docs/db/schema-design.md).
//
// Built to exercise the details the migration must not lose: mixed person-id types (1, "7",
// 99), adminPerms absent / null / a map, explicit nulls, unknown pass-through keys, custom-column
// values (_cc_*), a tombstoned job, nested moveLog / finishRequests, both payhours row kinds,
// a confirmed punch, a negative production adjustment, and stored order that isn't sorted.
// orgSeed() returns a fresh copy every call.

export const ORG = "TESTORG";
const k = (file) => `orgs/${ORG}/${file}`;
const T0 = "2026-10-01T12:00:00.000Z";

export function orgSeed() {
  return JSON.parse(JSON.stringify({
    [k("config.json")]: {
      name: "Test Panels Inc", domain: "testpanels.example", adminEmail: "ada@testpanels.example",
      adminEmails: ["ada@testpanels.example", "owner@testpanels.example"], adminName: "Ada Admin",
      industry: "Manufacturing", companySize: "11-50", country: "US", currency: "USD",
      createdAt: "2026-01-05T16:00:00.000Z", lastModifiedAt: T0,
    },
    [k("billing.json")]: { tier: "business", lastModifiedAt: T0 },
    [k("settings.json")]: {
      timeZone: "America/Denver", hpd: 8, workStart: "07:00", workEnd: "15:30", workDays: [1, 2, 3, 4, 5],
      holidays: ["2026-11-26"], lunch: { time: "12:00", durationMinutes: 30 }, breaks: [{ time: "10:00", durationMinutes: 15 }],
      roles: ["Wiring", "Fabrication", "Engineering"],
      statusOpts: [
        { name: "Not Started", color: "#94a3b8", icon: "circle" },
        { name: "In Progress", color: "#3b82f6", icon: "play", isActive: true },
        { name: "MTX FAT", color: "#a855f7", icon: "flag" },
        { name: "Finished", color: "#22c55e", icon: "check", isFinished: true },
      ],
      priOpts: [{ name: "High", color: "#ef4444" }, { name: "Medium", color: "#f59e0b" }, { name: "Low", color: "#10b981" }],
      customCols: [{ id: "cc1", label: "Shop Order", type: "text" }, { id: "cc2", label: "Stage", type: "select", options: [{ name: "Kit", color: "#ccc", icon: "" }] }],
      conditions: [], signOffTemplates: [{ id: "so1", name: "QC", steps: ["Torque", "Label"] }],
      approvalQueueLabel: "Approval Queue", approvalSteps: ["Review", "Approve", "Release"], approverLabel: "Approver",
      payPeriodType: "biweekly", payPeriodStart: "2026-01-04", payDates: [5, 20], payMode: "setdate", payPeriodHourCap: 80,
      trackLunch: true, trackBreaks: false, iosPayClockEnabled: true, lastModifiedAt: T0,
    },
    [k("people.json")]: [
      { id: 1, name: "Ada Admin", email: "ada@testpanels.example", role: "Engineering", department: "Engineering", userRole: "admin",
        cap: 8, color: "#2563eb", pin: "4321", timeOff: [], isEngineer: true, canSignOff: true, payType: "salary", lastModifiedAt: T0 },
      { id: "7", name: "Wendy Wirer", email: "wendy@testpanels.example", role: "Wiring", department: "Wiring", userRole: "user",
        cap: 8, color: "#16a34a", pin: "1111", payType: "hourly", phone: null, teamNumber: 2,
        timeOff: [{ start: "2026-10-20", end: "2026-10-21", type: "PTO", reason: "Dentist", reqId: "to_a1" }],
        iosOnlyFlag: { kept: true }, lastModifiedAt: T0 },
      { id: 99, name: "Sam Shop", email: "sam@testpanels.example", role: "Fabrication", department: "Fabrication", userRole: "user",
        cap: 7.5, color: "#f97316", payType: "hourly", canClockInOut: false, timeOff: [], noAutoSchedule: true, lastModifiedAt: T0 },
      { id: "12", name: "Rita Restricted", email: "rita@testpanels.example", role: "Engineering", department: "Engineering", userRole: "admin",
        adminPerms: { editJobs: true, moveJobs: true, reassign: false, manageTeam: false, manageClients: false, undoHistory: false,
          orgSettings: false, approveCompletions: true, approveTimeOff: false, manageTimeclock: false, confirmTimesheet: false },
        cap: 8, color: "#db2777", timeOff: [], lastModifiedAt: T0 },
      { id: "14", name: "Nora Null", email: "nora@testpanels.example", role: "Wiring", userRole: "admin", adminPerms: null, cap: 8, color: "#0891b2",
        timeOff: [], lastModifiedAt: T0 },
      { id: "15", name: "Gone Person", email: "gone@testpanels.example", role: "Wiring", userRole: "user", cap: 8, color: "#999999",
        timeOff: [], deletedAt: "2026-09-01T00:00:00.000Z", lastModifiedAt: "2026-09-01T00:00:00.000Z" },
    ],
    [k("clients.json")]: [
      { id: "c_acme", name: "Acme Water", contact: "Pat", email: "pat@acme.example", phone: "555-0100", color: "#0ea5e9", notes: "", lastModifiedAt: T0 },
      { id: "c_bolt", name: "Bolt Mining", contact: "", email: "", phone: "", color: "#f43f5e", notes: "net 45", lastModifiedAt: T0 },
    ],
    [k("tasks.json")]: [
      { id: "j1", title: "Lift Station 4", jobNumber: "24-117", poNumber: "PO-88", jobType: "Control Panel", status: "In Progress", pri: "High",
        start: "2026-10-12", end: "2026-10-23", dueDate: "2026-10-30", team: ["7", "99"], color: "#3b82f6", hpd: 64, notes: "",
        clientId: "c_acme", projectManagerId: "1", deps: [], loggedHours: 6.5, _cc_cc1: "SO-5521", createdAt: "2026-10-01T15:00:00.000Z",
        subs: [
          { id: "p1", title: "MCC-1", status: "In Progress", start: "2026-10-12", end: "2026-10-16", team: ["7"], hpd: 32, deps: [], loggedHours: 6.5,
            engineering: { designed: { by: "1", byName: "Ada Admin", at: "2026-10-02T15:00:00.000Z" }, verified: null, sentToPerforex: null },
            attachments: [{ key: `orgs/${ORG}/attachments/AbCdEfGhI-mcc1.pdf`, filename: "mcc1.pdf", mimeType: "application/pdf", size: 1200, uploadedById: "1", uploadedByName: "Ada Admin", uploadedAt: "2026-10-03T15:00:00.000Z" }],
            subs: [
              { id: "o1", title: "Mount backpan", status: "Finished", start: "2026-10-12", end: "2026-10-12", startHour: 7, endHour: 15.5, hpd: 8,
                team: ["7"], deps: [], loggedHours: 6.5, finishedAt: "2026-10-12T21:00:00.000Z",
                moveLog: [{ fromStart: "2026-10-09", fromEnd: "2026-10-09", toStart: "2026-10-12", toEnd: "2026-10-12", fromStartHour: 7, toStartHour: 7, date: "2026-10-08", movedBy: "Ada Admin", reason: "Moved in schedule" }],
                finishRequests: [{ id: "fr_1", by: "7", byName: "Wendy Wirer", at: "2026-10-12T20:00:00.000Z", status: "approved", resolvedBy: "1", resolvedByName: "Ada Admin", resolvedAt: "2026-10-12T21:00:00.000Z" }] },
              { id: "o2", title: "Wire terminals", status: "In Progress", start: "2026-10-13", end: "2026-10-14", startHour: 7, endHour: 15.5, hpd: 16,
                team: ["7"], deps: ["o1"], requiredDepartments: ["Wiring"], requiredDepartment: "Wiring" },
              { id: "o3", title: "Label", status: "Not Started", start: "", end: "", team: [], deps: ["__pending__"] },
            ] },
          { id: "p2", title: "RTU", status: "Not Started", start: "2026-10-19", end: "2026-10-23", team: ["99"], hpd: 32, deps: [],
            subs: [{ id: "o4", title: "Fab enclosure", status: "Not Started", start: "2026-10-19", end: "2026-10-21", startHour: 7, endHour: 11, hpd: 20, team: ["99"], deps: [] }] },
        ], lastModifiedAt: T0 },
      { id: "j2", title: "Crusher Retrofit", jobNumber: "24-120", status: "Not Started", pri: "Medium", start: "2026-11-02", end: "2026-11-06",
        team: [], hpd: null, clientId: "c_bolt", subs: [], lastModifiedAt: T0 },
      { id: "j0", title: "Cancelled bid", jobNumber: "24-101", status: "Not Started", subs: [], deletedAt: "2026-09-15T00:00:00.000Z", lastModifiedAt: "2026-09-15T00:00:00.000Z" },
    ],
    [k("groups.json")]: [
      { id: "g_cr", name: "Completion Requests", memberIds: [1, "12"], createdBy: 1, createdAt: T0, lastModifiedAt: T0 },
      { id: "g_floor", name: "Floor", memberIds: ["7", 99, 1], createdBy: "7", createdAt: T0, lastModifiedAt: T0 },
    ],
    [k("messages.json")]: [
      { id: "m1", threadKey: "dm:1_7", scope: "dm", text: "Can you start MCC-1 Monday?", authorId: "1", authorName: "Ada Admin", authorColor: "#2563eb", participantIds: ["1", "7"], attachments: [], timestamp: "2026-10-09T15:00:00.000Z", lastModifiedAt: "2026-10-09T15:00:00.000Z" },
      { id: "m2", threadKey: "dm:1_7", scope: "dm", text: "Yes", authorId: "7", authorName: "Wendy Wirer", participantIds: ["1", "7"], attachments: [], timestamp: "2026-10-09T15:05:00.000Z", lastModifiedAt: "2026-10-09T15:05:00.000Z" },
      { id: "m3", threadKey: "job:j1", scope: "job", jobId: "j1", text: "Drawings rev B attached", authorId: "1", authorName: "Ada Admin", participantIds: ["1"], attachments: [{ key: `orgs/${ORG}/attachments/ZzZzZzZzZ-revb.pdf`, filename: "revb.pdf", mimeType: "application/pdf", size: 900 }], timestamp: "2026-10-10T15:00:00.000Z", lastModifiedAt: "2026-10-10T15:00:00.000Z" },
      { id: "m4", threadKey: "group:g_floor", scope: "group", text: "Lunch at 12", authorId: "7", authorName: "Wendy Wirer", participantIds: [], attachments: [], timestamp: "2026-10-10T16:00:00.000Z" },
    ],
    [k("reads.json")]: { "dm:1_7": { "1": "2026-10-09T15:05:00.000Z", "7": "2026-10-09T15:00:00.000Z" } },
    [k("payhours.json")]: [
      { id: "tc_a", personId: "7", date: "2026-10-12", clockIn: "2026-10-12T13:00:00.000Z", clockOut: "2026-10-12T21:30:00.000Z", hours: 8, jobRefs: [{ jobId: "j1", panelId: "p1", opId: "o1" }], note: "", source: "kiosk", confirmed: true, confirmedAt: "2026-10-13T15:00:00.000Z", confirmedBy: "1", lastModifiedAt: "2026-10-13T15:00:00.000Z" },
      { id: "tce_a1", personId: "7", date: "2026-10-12", eventType: "lunchStart", timestamp: "2026-10-12T18:00:00.000Z", lastModifiedAt: "2026-10-12T18:00:00.000Z" },
      { id: "tce_a2", personId: "7", date: "2026-10-12", eventType: "lunchEnd", timestamp: "2026-10-12T18:30:00.000Z", lastModifiedAt: "2026-10-12T18:30:00.000Z" },
      { id: "tc_b", personId: 99, date: "2026-10-13", clockIn: "2026-10-13T13:05:00.000Z", clockOut: "2026-10-13T21:00:00.000Z", hours: 7.42, jobRefs: [], note: "left early", source: "ios-app", lastModifiedAt: "2026-10-13T21:00:00.000Z" },
    ],
    [k("productionhours.json")]: [
      { id: "js_a", personId: "7", jobId: "j1", panelId: "p1", opId: "o1", jobTitle: "Lift Station 4", panelTitle: "MCC-1", opTitle: "Mount backpan", clockIn: "2026-10-12T13:00:00.000Z", clockOut: "2026-10-12T20:00:00.000Z", hours: 6.5, date: "2026-10-12", source: "kiosk", lastModifiedAt: "2026-10-12T20:00:00.000Z" },
      { id: "js_adj", personId: "7", jobId: "j1", panelId: "p1", opId: "o1", clockIn: "2026-10-12T20:00:00.000Z", clockOut: "2026-10-12T20:00:00.000Z", hours: -0.5, date: "2026-10-12", source: "manual", adjustment: true, enteredBy: "1", enteredAt: "2026-10-13T15:00:00.000Z", lastModifiedAt: "2026-10-13T15:00:00.000Z" },
      { id: "js_m", personId: "7", jobId: "j1", panelId: "p1", opId: "o1", clockIn: "2026-10-12T20:00:00.000Z", clockOut: "2026-10-12T20:00:00.000Z", hours: 0.5, date: "2026-10-12", source: "manual", enteredBy: "1", enteredAt: "2026-10-13T15:01:00.000Z", lastModifiedAt: "2026-10-13T15:01:00.000Z" },
    ],
    [k("timeoff.json")]: [
      { id: "to_a1", personId: "7", personName: "Wendy Wirer", type: "PTO", start: "2026-10-20", end: "2026-10-21", note: "Dentist", status: "approved", createdAt: "2026-10-05T15:00:00.000Z", decidedBy: "1", decidedByName: "Ada Admin", decidedAt: "2026-10-05T16:00:00.000Z", denialReason: "", groupId: null },
      { id: "to_b2", personId: "99", personName: "Sam Shop", type: "UTO", start: "2026-11-09", end: "2026-11-09", note: "", status: "pending", createdAt: "2026-10-11T15:00:00.000Z", decidedBy: null, decidedByName: null, decidedAt: null, denialReason: "", groupId: null },
    ],
    [k("invites.json")]: [
      { id: "inv_1", token: "tok_live_aaaaaaaaaaaaaaaa", email: "newhire@testpanels.example", role: "user", invitedBy: "ada@testpanels.example", personId: null, name: "New Hire", createdAt: "2026-10-10T15:00:00.000Z", expiresAt: "2026-10-24T15:00:00.000Z", acceptedAt: null, revokedAt: null },
    ],
    [k("push-subs.json")]: { "1": [{ endpoint: "https://push.example/abc", keys: { p256dh: "BPub", auth: "aut" }, expirationTime: null, theme: "dark" }] },
    [k("user-settings/ada_testpanels.example.json")]: { themeMode: "dark", hiddenCols: ["poNumber"], colWidths: [120, 80], tMode: "week", lastModifiedAt: T0 },
    [k("jobclock-alerts.json")]: {},
    [k("rule-events.json")]: { dropped: {}, records: [] },
  }));
}

export const AUTH = {
  ada: { personId: "1", isAdmin: true, adminPerms: null, email: "ada@testpanels.example", orgCode: ORG, canClockInOut: true, canSignOff: true, isEngineer: true },
  rita: { personId: "12", isAdmin: true, adminPerms: orgSeed()[k("people.json")][3].adminPerms, email: "rita@testpanels.example", orgCode: ORG, canClockInOut: true, canSignOff: false, isEngineer: false },
  wendy: { personId: "7", isAdmin: false, adminPerms: null, email: "wendy@testpanels.example", orgCode: ORG, canClockInOut: true, canSignOff: false, isEngineer: false },
  sam: { personId: "99", isAdmin: false, adminPerms: null, email: "sam@testpanels.example", orgCode: ORG, canClockInOut: false, canSignOff: false, isEngineer: false },
};
