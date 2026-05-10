import { buildPrUrl } from "../../../src/git/push.js";

describe("buildPrUrl — Bitbucket", () => {
    it("composes a Bitbucket Cloud PR URL from an SSH remote", () => {
        expect(buildPrUrl({
            remoteUrl: "git@bitbucket.org:myteam/myrepo.git",
            sourceBranch: "task/2026-05-09-fix",
            destBranch: "main",
        })).toBe("https://bitbucket.org/myteam/myrepo/pull-requests/new?source=task/2026-05-09-fix&dest=main");
    });

    it("handles https Bitbucket remote URLs", () => {
        expect(buildPrUrl({
            remoteUrl: "https://bitbucket.org/team/repo.git",
            sourceBranch: "task/x",
            destBranch: "develop",
        })).toBe("https://bitbucket.org/team/repo/pull-requests/new?source=task/x&dest=develop");
    });
});

describe("buildPrUrl — GitHub", () => {
    it("composes a GitHub compare URL from an SSH remote", () => {
        expect(buildPrUrl({
            remoteUrl: "git@github.com:igorzheludkov/test-app.git",
            sourceBranch: "task/2026-05-10-foo",
            destBranch: "main",
        })).toBe("https://github.com/igorzheludkov/test-app/compare/main...task/2026-05-10-foo?expand=1");
    });

    it("handles https GitHub remote URLs (with and without .git suffix)", () => {
        expect(buildPrUrl({
            remoteUrl: "https://github.com/owner/repo.git",
            sourceBranch: "task/x",
            destBranch: "main",
        })).toBe("https://github.com/owner/repo/compare/main...task/x?expand=1");

        expect(buildPrUrl({
            remoteUrl: "https://github.com/owner/repo",
            sourceBranch: "task/x",
            destBranch: "main",
        })).toBe("https://github.com/owner/repo/compare/main...task/x?expand=1");
    });
});

describe("buildPrUrl — unknown host", () => {
    it("returns null for GitLab and other unrecognized hosts", () => {
        expect(buildPrUrl({
            remoteUrl: "git@gitlab.com:foo/bar.git",
            sourceBranch: "task/x",
            destBranch: "main",
        })).toBeNull();
    });

    it("returns null for non-URL strings", () => {
        expect(buildPrUrl({
            remoteUrl: "not-a-url",
            sourceBranch: "task/x",
            destBranch: "main",
        })).toBeNull();
    });
});
