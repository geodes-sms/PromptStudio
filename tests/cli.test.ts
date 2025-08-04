import { exec } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

const cliPath = path.resolve(__dirname, "../headless/cli.ts");

// We will create a temp root folder with this structure:
// tmpRoot/credentials.json
// tmpRoot/tmp2/test.yml
// Then run cli with cwd = tmpRoot/tmp2

// Helper to run CLI from cwd=tmp2 folder
function runCli(args: string, cwd: string) {
    return new Promise<{ stdout: string; stderr: string }>((resolve) => {
        exec(`npx tsx ${cliPath} ${args}`, { cwd }, (error, stdout, stderr) => {
            resolve({ stdout, stderr });
        });
    });
}

let tmpRoot: string;
let tmp2Dir: string;

beforeAll(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tmp-root"));
    tmp2Dir = path.join(tmpRoot, "tmp2");
    await fs.mkdir(tmp2Dir);
});

afterEach(async () => {
    // Clean tmp2Dir contents
    const files = await fs.readdir(tmp2Dir);
    await Promise.all(files.map(f => fs.unlink(path.join(tmp2Dir, f))));
    // Clean tmpRoot root files except tmp2 folder (optional)
    const rootFiles = await fs.readdir(tmpRoot);
    await Promise.all(
        rootFiles
            .filter(f => f !== "tmp2")
            .map(f => fs.unlink(path.join(tmpRoot, f)))
    );
});

afterAll(async () => {
    // Remove everything
    await fs.rm(tmpRoot, { recursive: true, force: true });
});

test("fails when credentials.json missing", async () => {
    // Create only config file inside tmp2
    await fs.writeFile(path.join(tmp2Dir, "test.yml"), "name: dummy\n");

    const { stderr } = await runCli("-c test.yml", tmp2Dir);
    expect(stderr).toContain("Required file 'credentials.json' not found");
});

test("fails when both -c and -n provided", async () => {
    // Create credentials.json in root tmp folder
    await fs.writeFile(path.join(tmpRoot, "credentials.json"), JSON.stringify({ api_keys: { test: "abc" } }));
    await fs.writeFile(path.join(tmp2Dir, "test.yml"), "name: dummy\n");

    const { stderr } = await runCli("-c test.yml -n dummy", tmp2Dir);
    expect(stderr).toContain("Please chose only 1 option.");
});

test("fails when config file missing", async () => {
    // Create credentials.json in root tmp folder
    await fs.writeFile(path.join(tmpRoot, "credentials.json"), JSON.stringify({ api_keys: { test: "abc" } }));

    const { stderr } = await runCli("-c test.yml", tmp2Dir);
    expect(stderr).toContain("Configuration file not found");
});