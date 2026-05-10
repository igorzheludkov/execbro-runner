import {
    adbReverseCommand,
    adbLaunchCommand,
    parseBootCompleted,
} from "../../../src/provisioner/android.js";

describe("adbReverseCommand", () => {
    it("constructs adb reverse for the given device and port", () => {
        expect(adbReverseCommand("emulator-5554", 8092)).toEqual([
            "-s", "emulator-5554", "reverse", "tcp:8092", "tcp:8092",
        ]);
    });
});

describe("adbLaunchCommand", () => {
    it("constructs adb shell am start with the package's MainActivity", () => {
        expect(adbLaunchCommand("emulator-5554", "com.example.myapp")).toEqual([
            "-s", "emulator-5554", "shell", "am", "start",
            "-n", "com.example.myapp/.MainActivity",
        ]);
    });
});

describe("parseBootCompleted", () => {
    it("returns true for output of '1'", () => {
        expect(parseBootCompleted("1\n")).toBe(true);
    });

    it("returns false for output of '0'", () => {
        expect(parseBootCompleted("0\n")).toBe(false);
    });

    it("returns false for empty output", () => {
        expect(parseBootCompleted("")).toBe(false);
    });
});
