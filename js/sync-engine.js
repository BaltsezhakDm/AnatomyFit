/**
 * Ядро Delta Sync: сбор локальных изменений (push) и применение серверных (pull).
 * Не зависит от window/сети — работает только с Dexie, поэтому тестируется отдельно.
 */

import { db, generateUUID, BASE_EXERCISE_UUIDS, withRemoteChanges } from './db.js';
import {
  isChangedSince,
  shouldApplyRemote,
  primaryMuscleFromLoads,
  parseMuscleLoads,
  computeSetOrders,
  mapLogToServer,
  mapMachineToServer,
  buildSessions,
  mapProgramToServer,
  resolveProgramExerciseIds,
  resolvePlan,
  localSessionIdFromUuid,
} from './core/sync-mapping.js';

/** Карты «локальный id упражнения <-> серверный UUID»; недостающие UUID сохраняются, а не генерируются заново при каждом синке. */
async function loadExerciseMaps() {
  const exercises = await db.exercises.toArray();
  const idToUuid = new Map();
  const uuidToId = new Map();
  for (const ex of exercises) {
    let uuid = ex.uuid;
    if (!uuid) {
      uuid = BASE_EXERCISE_UUIDS[ex.name] || generateUUID();
      await db.exercises.update(ex.id, { uuid, updatedAt: ex.updatedAt || Date.now() });
    }
    idToUuid.set(ex.id, uuid);
    uuidToId.set(uuid, ex.id);
  }
  return { exercises, idToUuid, uuidToId };
}

/**
 * Собирает изменения с момента pushCursor (по локальным часам) и tombstones удалений.
 * @returns {{ push: object, tombstoneIds: number[], skipped: number }}
 */
export async function collectPush(pushCursor) {
  const { exercises, idToUuid } = await loadExerciseMaps();
  const tombstones = await db.tombstones.toArray();
  const deletedOf = name => tombstones.filter(t => t.table === name);
  let skipped = 0;

  const push = {
    exercises: [],
    machines: [],
    programs: [],
    workoutSessions: [],
    workoutSets: [],
    bodyMeasurements: [],
  };

  const exercisePayload = (ex, deletedAt = null) => ({
    id: ex.uuid || idToUuid.get(ex.id),
    name: ex.name,
    category: 'strength',
    movementPattern: ex.movementPattern || 'other',
    equipment: ex.equipment || 'barbell',
    usesBodyweight: ex.usesBodyweight || 0,
    muscleLoads: ex.muscleLoads || {},
    updatedAt: deletedAt || ex.updatedAt || Date.now(),
    deletedAt,
  });

  for (const ex of exercises) {
    if (ex.isCustom && isChangedSince(ex, pushCursor)) push.exercises.push(exercisePayload({ ...ex, uuid: idToUuid.get(ex.id) }));
  }
  for (const t of deletedOf('exercises')) {
    if (t.snapshot?.isCustom) push.exercises.push(exercisePayload(t.snapshot, t.deletedAt));
  }

  const programs = await db.programs.toArray();
  for (const p of programs) {
    if (isChangedSince(p, pushCursor)) push.programs.push(mapProgramToServer(p, idToUuid));
  }
  for (const t of deletedOf('programs')) {
    push.programs.push(mapProgramToServer(t.snapshot, idToUuid, t.deletedAt));
  }

  // Тренажёры уходят раньше подходов, которые на них ссылаются
  const machines = await db.machines.toArray();
  const machineIdToUuid = new Map(machines.filter(m => m.uuid).map(m => [m.id, m.uuid]));
  for (const m of machines) {
    if (!isChangedSince(m, pushCursor)) continue;
    const mapped = mapMachineToServer(m, idToUuid);
    if (mapped) push.machines.push(mapped);
  }
  for (const t of deletedOf('machines')) {
    const mapped = mapMachineToServer(t.snapshot, idToUuid, t.deletedAt);
    if (mapped) push.machines.push(mapped);
  }

  const logs = await db.workoutLogs.toArray();
  const orders = computeSetOrders(logs);
  const changedLogs = logs.filter(l => isChangedSince(l, pushCursor));
  for (const log of changedLogs) {
    const mapped = mapLogToServer(log, idToUuid, orders.get(log.id) || 1, null, machineIdToUuid);
    if (mapped) push.workoutSets.push(mapped);
    else skipped++;
  }
  for (const t of deletedOf('workoutLogs')) {
    const mapped = mapLogToServer(t.snapshot, idToUuid, 1, t.deletedAt, machineIdToUuid);
    if (mapped) push.workoutSets.push(mapped);
  }
  // Сессии нужны всем отправляемым подходам (даже если сама сессия не менялась) — иначе сервер отклонит подход
  // Оценка «после» ставится уже после последнего подхода: сессия с изменившимися метаданными отправляется заново
  const metas = await db.sessionMeta.toArray();
  const metaBySessionId = new Map(metas.map(m => [m.sessionId, m]));
  const sentSessionKeys = new Set(
    changedLogs.filter(l => idToUuid.has(l.exerciseId)).map(l => l.sessionId || null)
  );
  for (const m of metas) if (isChangedSince(m, pushCursor)) sentSessionKeys.add(m.sessionId);
  push.workoutSessions = buildSessions(logs.filter(l => sentSessionKeys.has(l.sessionId || null)), metaBySessionId);

  const weights = await db.bodyWeightLogs.toArray();
  const measurement = (bw, deletedAt = null) => ({
    id: bw.uuid,
    logDate: bw.date,
    weight: bw.weight,
    updatedAt: deletedAt || bw.updatedAt || Date.now(),
    deletedAt,
  });
  for (const bw of weights) {
    if (isChangedSince(bw, pushCursor)) push.bodyMeasurements.push(measurement(bw));
  }
  for (const t of deletedOf('bodyWeightLogs')) {
    push.bodyMeasurements.push(measurement(t.snapshot, t.deletedAt));
  }

  return { push, tombstoneIds: tombstones.map(t => t.id), skipped };
}

async function existingByUuid(table, uuids) {
  if (uuids.length === 0) return new Map();
  const rows = await table.where('uuid').anyOf(uuids).toArray();
  return new Map(rows.map(r => [r.uuid, r]));
}

/**
 * Применяет ответ сервера локально одной транзакцией.
 * @returns {{ deferred: number }} — сколько строк пока нельзя применить (ссылаются на ещё не загруженное упражнение)
 */
export async function applyPull(pull) {
  if (!pull) return { deferred: 0 };

  return withRemoteChanges(() =>
    db.transaction('rw', db.exercises, db.machines, db.programs, db.workoutLogs, db.bodyWeightLogs, db.sessionMeta, async () => {
      let deferred = 0;

      // Упражнения: каталог встроенных упражнений локально главный, обновляем только пользовательские
      const remoteExercises = Array.isArray(pull.exercises) ? pull.exercises : [];
      const exByUuid = await existingByUuid(db.exercises, remoteExercises.map(e => e.id));
      for (const ex of remoteExercises) {
        const local = exByUuid.get(ex.id);
        if (ex.deletedAt) {
          if (local && local.isCustom) await db.exercises.delete(local.id);
          continue;
        }
        const loads = parseMuscleLoads(ex.muscleLoads);
        const fields = {
          name: ex.name,
          primaryMuscle: primaryMuscleFromLoads(loads),
          movementPattern: ex.movementPattern || 'other',
          equipment: ex.equipment || 'barbell',
          usesBodyweight: ex.usesBodyweight ? 1 : 0,
          muscleLoads: loads,
          updatedAt: ex.updatedAt,
        };
        if (local) {
          if (local.isCustom && shouldApplyRemote(local, ex.updatedAt)) await db.exercises.update(local.id, fields);
        } else {
          await db.exercises.add({ uuid: ex.id, isCustom: ex.userId || ex.isCustom ? 1 : 0, ...fields });
        }
      }

      const uuidToId = new Map((await db.exercises.toArray()).filter(e => e.uuid).map(e => [e.uuid, e.id]));

      // Тренажёры упражнений
      const remoteMachines = Array.isArray(pull.machines) ? pull.machines : [];
      const machineByUuid = await existingByUuid(db.machines, remoteMachines.map(m => m.id));
      for (const m of remoteMachines) {
        const local = machineByUuid.get(m.id);
        if (m.deletedAt) {
          if (local) await db.machines.delete(local.id);
          continue;
        }
        const exerciseId = uuidToId.get(m.exerciseId);
        if (exerciseId === undefined) {
          deferred++;
          continue;
        }
        const fields = {
          exerciseId,
          name: m.name,
          kind: m.kind || 'other',
          step: m.step ?? null,
          factor: m.factor ?? 1,
          factorSource: m.factorSource || 'same',
          base: m.baseLoad ?? m.base ?? 0,
          updatedAt: m.updatedAt,
        };
        if (local) {
          if (shouldApplyRemote(local, m.updatedAt)) await db.machines.update(local.id, fields);
        } else {
          await db.machines.add({ uuid: m.id, ...fields });
        }
      }
      const uuidToMachineId = new Map((await db.machines.toArray()).filter(m => m.uuid).map(m => [m.uuid, m.id]));

      // Программы вместе со списком упражнений
      const remotePrograms = Array.isArray(pull.programs) ? pull.programs : [];
      const progByUuid = await existingByUuid(db.programs, remotePrograms.map(p => p.id));
      for (const p of remotePrograms) {
        const local = progByUuid.get(p.id);
        if (p.deletedAt) {
          if (local) await db.programs.delete(local.id);
          continue;
        }
        const { ids, unknown } = resolveProgramExerciseIds(p.exerciseIds, uuidToId);
        // План (слоты, неделя цикла) приходит вместе с программой; без него локальные настройки не трогаем
        const plan = resolvePlan(p.plan, uuidToId);
        deferred += unknown + (plan ? plan.unknown : 0);
        const planFields = plan
          ? {
              slots: plan.slots,
              ...(plan.cycle ? { cycle: plan.cycle } : {}),
              ...(plan.sessionsPerWeek ? { sessionsPerWeek: plan.sessionsPerWeek } : {}),
              ...(plan.cycleWeeks ? { cycleWeeks: plan.cycleWeeks } : {}),
            }
          : {};
        if (local) {
          if (shouldApplyRemote(local, p.updatedAt)) {
            await db.programs.update(local.id, { name: p.name, exerciseIds: ids, ...planFields, updatedAt: p.updatedAt });
          }
        } else {
          await db.programs.add({ uuid: p.id, name: p.name, exerciseIds: ids, ...planFields, updatedAt: p.updatedAt });
        }
      }

      // Замеры веса
      const remoteWeights = Array.isArray(pull.bodyMeasurements) ? pull.bodyMeasurements : [];
      const bwByUuid = await existingByUuid(db.bodyWeightLogs, remoteWeights.map(b => b.id));
      for (const bm of remoteWeights) {
        const local = bwByUuid.get(bm.id);
        if (bm.deletedAt) {
          if (local) await db.bodyWeightLogs.delete(local.id);
        } else if (local) {
          if (shouldApplyRemote(local, bm.updatedAt)) {
            await db.bodyWeightLogs.update(local.id, { date: bm.logDate, weight: bm.weight, updatedAt: bm.updatedAt });
          }
        } else {
          await db.bodyWeightLogs.add({ uuid: bm.id, date: bm.logDate, weight: bm.weight, updatedAt: bm.updatedAt });
        }
      }

      // Самочувствие до/после: метаданные сессий (сами сессии локально — набор подходов)
      const remoteSessions = Array.isArray(pull.workoutSessions) ? pull.workoutSessions : [];
      for (const ws of remoteSessions) {
        const hasMeta = ws.readinessPre != null || ws.feelingPost != null || (ws.preTags && ws.preTags.length > 0);
        const sessionId = localSessionIdFromUuid(ws.id);
        if (!hasMeta || sessionId === null) continue;
        const local = await db.sessionMeta.where('sessionId').equals(sessionId).first();
        if (local && !shouldApplyRemote(local, ws.updatedAt)) continue;
        const fields = {
          readinessPre: ws.readinessPre ?? null,
          feelingPost: ws.feelingPost ?? null,
          preTags: ws.preTags || [],
          note: ws.comment || null,
          updatedAt: ws.updatedAt,
        };
        if (local) await db.sessionMeta.update(local.id, fields);
        else await db.sessionMeta.add({ sessionId, ...fields });
      }

      // Подходы: sessionId восстанавливается из UUID сессии, неизвестное упражнение откладывает строку
      const remoteSets = Array.isArray(pull.workoutSets) ? pull.workoutSets : [];
      const setByUuid = await existingByUuid(db.workoutLogs, remoteSets.map(s => s.id));
      for (const s of remoteSets) {
        const local = setByUuid.get(s.id);
        if (s.deletedAt) {
          if (local) await db.workoutLogs.delete(local.id);
          continue;
        }
        const exerciseId = uuidToId.get(s.exerciseId);
        const machineId = s.machineId ? uuidToMachineId.get(s.machineId) : undefined;
        if (exerciseId === undefined || (s.machineId && machineId === undefined)) {
          deferred++; // упражнение или тренажёр ещё не загружены — подход применится при следующем синке
          continue;
        }
        const fields = {
          date: s.logDate,
          exerciseId,
          ...(machineId !== undefined ? { machineId } : {}),
          weight: s.weight,
          reps: s.reps,
          comment: s.comment,
          ...(s.rir !== undefined && s.rir !== null ? { rir: s.rir } : {}),
          updatedAt: s.updatedAt,
        };
        if (local) {
          if (shouldApplyRemote(local, s.updatedAt)) await db.workoutLogs.update(local.id, fields);
        } else {
          await db.workoutLogs.add({
            uuid: s.id,
            sessionId: localSessionIdFromUuid(s.sessionId) ?? s.completedAt ?? Date.now(),
            ...fields,
          });
        }
      }

      return { deferred };
    })
  );
}
