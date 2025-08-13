import {cartesianProduct, fillTemplate} from '../backend/api/configHandler';
import {PromptVarsDict} from "../backend/typing";

jest.mock('../backend/database/database', () => ({
    pool: jest.fn(),
}));

describe('cartesianProduct with complex multi-key objects', () => {
    it('computes cartesian product with two arrays', () => {
        const input = [
            [
                { a: '1', b: '2' },
                { a: '3', b: '4' }
            ],
            [
                { c: 'x', d: 'y' },
                { c: 'z', d: 'w' }
            ]
        ];

        const output = cartesianProduct(input);
        expect(output).toEqual([
            { a: '1', b: '2', c: 'x', d: 'y' },
            { a: '1', b: '2', c: 'z', d: 'w' },
            { a: '3', b: '4', c: 'x', d: 'y' },
            { a: '3', b: '4', c: 'z', d: 'w' }
        ]);
    });

    it('computes cartesian product with three arrays', () => {
        const input = [
            [
                { a: '1', b: '2' },
                { a: '3', b: '4' }
            ],
            [
                { c: 'x' },
                { c: 'y' }
            ],
            [
                { d: 'm', e: 'n' },
                { d: 'o', e: 'p' }
            ]
        ];

        const output = cartesianProduct(input);

        expect(output).toEqual([
            { a: '1', b: '2', c: 'x', d: 'm', e: 'n' },
            { a: '1', b: '2', c: 'x', d: 'o', e: 'p' },
            { a: '1', b: '2', c: 'y', d: 'm', e: 'n' },
            { a: '1', b: '2', c: 'y', d: 'o', e: 'p' },
            { a: '3', b: '4', c: 'x', d: 'm', e: 'n' },
            { a: '3', b: '4', c: 'x', d: 'o', e: 'p' },
            { a: '3', b: '4', c: 'y', d: 'm', e: 'n' },
            { a: '3', b: '4', c: 'y', d: 'o', e: 'p' }
        ]);
    });
});

describe("renderTemplate", () => {
    it("replaces multiple markers", () => {
        const template = "Hello {name}, welcome to {place}!";
        const vars: PromptVarsDict = {
            name: "Alice",
            place: "Wonderland",
        };

        const result = fillTemplate(template, vars);
        expect(result).toBe("Hello Alice, welcome to Wonderland!");
    });

    it("leaves unknown markers untouched", () => {
        const template = "Hi {user}, your {status} is pending.";
        const vars: PromptVarsDict = {
            user: "Bob",
            // 'status' missing
        };

        const result = fillTemplate(template, vars);
        expect(result).toBe("Hi Bob, your {status} is pending.");
    });

    it("works with adjacent markers", () => {
        const template = "{a}{b}{c}";
        const vars: PromptVarsDict = {
            a: "1",
            b: "2",
            c: "3",
        };

        const result = fillTemplate(template, vars);
        expect(result).toBe("123");
    });

    it("ignores non-string values", () => {
        const template = "Value: {key}";
        const vars = {
            key: null,
        } as PromptVarsDict;

        const result = fillTemplate(template, vars);
        expect(result).toBe("Value: {key}");
    });

    it("replaces repeated markers consistently", () => {
        const template = "{item} {item} {item}";
        const vars: PromptVarsDict = {
            item: "echo",
        };

        const result = fillTemplate(template, vars);
        expect(result).toBe("echo echo echo");
    });
});