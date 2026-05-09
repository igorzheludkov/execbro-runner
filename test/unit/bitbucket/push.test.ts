import { buildBitbucketPrUrl } from "../../../src/bitbucket/push.js";

describe("buildBitbucketPrUrl", () => {
    it("composes a Bitbucket Cloud PR URL from a remote URL", () => {
        const url = buildBitbucketPrUrl({
            remoteUrl: "git@bitbucket.org:myteam/myrepo.git",
            sourceBranch: "task/2026-05-09-fix",
            destBranch: "main",
        });
        expect(url).toBe("https://bitbucket.org/myteam/myrepo/pull-requests/new?source=task/2026-05-09-fix&dest=main");
    });

    it("handles https remote URLs", () => {
        const url = buildBitbucketPrUrl({
            remoteUrl: "https://bitbucket.org/team/repo.git",
            sourceBranch: "task/x",
            destBranch: "develop",
        });
        expect(url).toBe("https://bitbucket.org/team/repo/pull-requests/new?source=task/x&dest=develop");
    });

    it("throws on a non-bitbucket remote", () => {
        expect(() => buildBitbucketPrUrl({
            remoteUrl: "git@github.com:x/y.git", sourceBranch: "x", destBranch: "main",
        })).toThrow(/bitbucket/i);
    });
});
