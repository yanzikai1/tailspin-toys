import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDatabase } from '../../db/test-helpers';
import { categories, publishers, games } from '../../db/schema';
import type { Database } from './db';
import {
    getAllGames,
    getAllGameIds,
    getGameById,
    getFilteredGames,
} from './games';

async function seedGames(db: Database, count: number): Promise<void> {
    const [category] = await db
        .insert(categories)
        .values({ name: 'Strategy', description: 'cat' })
        .returning({ id: categories.id });
    const [publisher] = await db
        .insert(publishers)
        .values({ name: 'Pub One', description: 'pub' })
        .returning({ id: publishers.id });

    // Insert titles in reverse-alphabetical order to prove ordering is applied.
    for (let i = count; i >= 1; i--) {
        await db.insert(games).values({
            title: `Game ${String(i).padStart(2, '0')}`,
            description: `Description ${i}`,
            starRating: 4.2,
            categoryId: category.id,
            publisherId: publisher.id,
        });
    }
}

interface FilterFixture {
    actionCategoryId: number;
    puzzleCategoryId: number;
    strategyCategoryId: number;
    firstPublisherId: number;
    secondPublisherId: number;
}

async function seedFilterGames(db: Database): Promise<FilterFixture> {
    const [action, puzzle, strategy] = await db
        .insert(categories)
        .values([
            { name: 'Action', description: 'Action games' },
            { name: 'Puzzle', description: 'Puzzle games' },
            { name: 'Strategy', description: 'Strategy games' },
        ])
        .returning({ id: categories.id });
    const [firstPublisher, secondPublisher] = await db
        .insert(publishers)
        .values([
            { name: 'First Publisher', description: 'First publisher' },
            { name: 'Second Publisher', description: 'Second publisher' },
        ])
        .returning({ id: publishers.id });

    await db.insert(games).values([
        {
            title: 'Delta Action',
            description: 'Action from the second publisher',
            starRating: 4.1,
            categoryId: action.id,
            publisherId: secondPublisher.id,
        },
        {
            title: 'Beta Puzzle',
            description: 'Puzzle from the first publisher',
            starRating: 4.2,
            categoryId: puzzle.id,
            publisherId: firstPublisher.id,
        },
        {
            title: 'Gamma Strategy',
            description: 'Strategy from the second publisher',
            starRating: 4.3,
            categoryId: strategy.id,
            publisherId: secondPublisher.id,
        },
        {
            title: 'Alpha Action',
            description: 'Action from the first publisher',
            starRating: 4.4,
            categoryId: action.id,
            publisherId: firstPublisher.id,
        },
    ]);

    return {
        actionCategoryId: action.id,
        puzzleCategoryId: puzzle.id,
        strategyCategoryId: strategy.id,
        firstPublisherId: firstPublisher.id,
        secondPublisherId: secondPublisher.id,
    };
}

describe('games data-access helpers', () => {
    let db: Database;

    beforeEach(async () => {
        db = await createTestDatabase();
    });

    it('returns all games ordered by title', async () => {
        await seedGames(db, 3);
        const all = await getAllGames(db);
        expect(all.map((g) => g.title)).toEqual(['Game 01', 'Game 02', 'Game 03']);
        expect(all[0].category).toEqual({ id: expect.any(Number), name: 'Strategy' });
        expect(all[0].publisher).toEqual({ id: expect.any(Number), name: 'Pub One' });
    });

    it('returns all game ids ordered by title', async () => {
        await seedGames(db, 3);
        const ids = await getAllGameIds(db);
        const all = await getAllGames(db);
        expect(ids).toEqual(all.map((g) => g.id));
    });

    it('fetches a single game by id', async () => {
        await seedGames(db, 2);
        const ids = await getAllGameIds(db);
        const game = await getGameById(db, ids[0]);
        expect(game?.title).toBe('Game 01');
    });

    it('returns null for a non-existent game', async () => {
        await seedGames(db, 2);
        expect(await getGameById(db, 99999)).toBeNull();
    });

    it('filters games by one category', async () => {
        const fixture = await seedFilterGames(db);
        const filtered = await getFilteredGames(db, {
            categoryIds: [fixture.actionCategoryId],
        });

        expect(filtered.map((game) => game.title)).toEqual([
            'Alpha Action',
            'Delta Action',
        ]);
    });

    it('matches games in any selected category', async () => {
        const fixture = await seedFilterGames(db);
        const filtered = await getFilteredGames(db, {
            categoryIds: [fixture.actionCategoryId, fixture.puzzleCategoryId],
        });

        expect(filtered.map((game) => game.title)).toEqual([
            'Alpha Action',
            'Beta Puzzle',
            'Delta Action',
        ]);
    });

    it('filters games by publisher', async () => {
        const fixture = await seedFilterGames(db);
        const filtered = await getFilteredGames(db, {
            publisherId: fixture.secondPublisherId,
        });

        expect(filtered.map((game) => game.title)).toEqual([
            'Delta Action',
            'Gamma Strategy',
        ]);
    });

    it('combines category and publisher filters', async () => {
        const fixture = await seedFilterGames(db);
        const filtered = await getFilteredGames(db, {
            categoryIds: [fixture.actionCategoryId],
            publisherId: fixture.firstPublisherId,
        });

        expect(filtered.map((game) => game.title)).toEqual(['Alpha Action']);
    });

    it('returns an empty collection when no games match', async () => {
        const fixture = await seedFilterGames(db);
        const filtered = await getFilteredGames(db, {
            categoryIds: [fixture.strategyCategoryId],
            publisherId: fixture.firstPublisherId,
        });

        expect(filtered).toEqual([]);
    });

    it('treats an empty category selection as unfiltered', async () => {
        await seedFilterGames(db);
        const filtered = await getFilteredGames(db, { categoryIds: [] });

        expect(filtered.map((game) => game.title)).toEqual([
            'Alpha Action',
            'Beta Puzzle',
            'Delta Action',
            'Gamma Strategy',
        ]);
    });
});
