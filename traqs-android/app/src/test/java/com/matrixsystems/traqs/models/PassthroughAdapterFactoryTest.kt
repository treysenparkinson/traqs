package com.matrixsystems.traqs.models

import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.google.gson.reflect.TypeToken
import com.matrixsystems.traqs.services.lenientGson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// #524 step (2) — the first time PassthroughAdapterFactory has run. Every Android save
// POSTs a whole array and the server stores it, so what this factory drops, Android
// deletes for every client (#520). Run through the app's OWN Gson (ApiService's
// lenientGson), not a fresh one: the factory only works as registered there.
class PassthroughAdapterFactoryTest {
    private val jobsType = object : TypeToken<List<TRAQSJob>>() {}.type
    private val peopleType = object : TypeToken<List<Person>>() {}.type

    private fun readJobs(json: String): List<TRAQSJob> = lenientGson.fromJson(json, jobsType)
    private fun writeJobs(jobs: List<TRAQSJob>): JsonObject =
        JsonParser.parseString(lenientGson.toJson(jobs, jobsType)).asJsonArray[0].asJsonObject

    private val job = """
      [{"id":"J1","title":"Job","status":"MTX FAT","pri":"On time","dueDate":"2026-11-01",
        "plannedHours":12.5,"depsMode":"locked","color":"#123456",
        "subs":[{"id":"P1","title":"Panel","finishRequests":[{"id":"R1","status":"approved"}],
          "engineering":{"designed":{"by":"t1","byName":"Ann","at":"2026-10-01","note":"ok"},"approvedBy":"t9"},
          "subs":[{"id":"O1","title":"Op","team":["t1"],"hpd":4,"startHour":8.5,"customCol":"x"}]}]}]
    """.trimIndent()

    @Test fun anUndeclaredKeySurvives() {
        val out = writeJobs(readJobs(job))
        assertEquals(12.5, out["plannedHours"].asDouble, 0.0)
        assertEquals("locked", out["depsMode"].asString)
    }

    @Test fun anEnumValueWithNoCaseSurvives() {
        val j = readJobs(job)[0]
        assertNull("no case for MTX FAT reads as null", j.statusOrNull)
        val out = writeJobs(listOf(j))
        assertEquals("MTX FAT", out["status"].asString)
        assertEquals("On time", out["pri"].asString)
    }

    @Test fun aFieldTheAppClearedStaysCleared() {
        val j = readJobs(job)[0].copy(dueDate = null)
        val out = writeJobs(listOf(j))
        assertFalse("a cleared dueDate must not come back from extras", out.has("dueDate") && !out["dueDate"].isJsonNull)
    }

    @Test fun aFieldTheAppSetWinsOverTheCapturedOne() {
        val j = readJobs(job)[0].copy(statusOrNull = JobStatus.FINISHED, priOrNull = Priority.HIGH)
        val out = writeJobs(listOf(j))
        assertEquals("Finished", out["status"].asString)
        assertEquals("High", out["pri"].asString)
    }

    @Test fun nestedCarriersEachKeepTheirs() {
        val out = writeJobs(readJobs(job))
        val panel = out["subs"].asJsonArray[0].asJsonObject
        assertEquals("R1", panel["finishRequests"].asJsonArray[0].asJsonObject["id"].asString)
        val eng = panel["engineering"].asJsonObject
        assertEquals("t9", eng["approvedBy"].asString)
        assertEquals("ok", eng["designed"].asJsonObject["note"].asString)
        val op = panel["subs"].asJsonArray[0].asJsonObject
        assertEquals(8.5, op["startHour"].asDouble, 0.0)
        assertEquals("x", op["customCol"].asString)
    }

    @Test fun anUnestimatedNodeStaysZero() {
        val out = writeJobs(readJobs("""[{"id":"J2","title":"T","subs":[]}]"""))
        assertEquals("an absent hpd must not be written as 7.5 (#520)", 0.0, out["hpd"].asDouble, 0.0)
    }

    @Test fun aPersonsTimeOffEntryKeepsItsIdAndStatus() {
        // #149: the web can only start giving time-off entries ids once every native save carries them.
        val people: List<Person> = lenientGson.fromJson(
            """[{"id":"t7","name":"W","department":"Wire","timeOff":[{"id":"to_a","start":"2026-11-02","end":"2026-11-02","type":"PTO","status":"approved"}]}]""",
            peopleType)
        val out = JsonParser.parseString(lenientGson.toJson(people, peopleType)).asJsonArray[0].asJsonObject
        assertEquals("Wire", out["department"].asString)
        val entry = out["timeOff"].asJsonArray[0].asJsonObject
        assertEquals("to_a", entry["id"].asString)
        assertEquals("approved", entry["status"].asString)
        assertTrue(entry["start"].asString == "2026-11-02")
    }
}
