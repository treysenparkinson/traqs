package com.matrixsystems.traqs.models

import com.google.gson.Gson
import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.google.gson.TypeAdapter
import com.google.gson.TypeAdapterFactory
import com.google.gson.annotations.SerializedName
import com.google.gson.reflect.TypeToken
import com.google.gson.stream.JsonReader
import com.google.gson.stream.JsonWriter
import java.lang.reflect.Modifier

// #520 — AN ANDROID SAVE WRITES BACK WHAT IT READ.
//
// Every save here POSTs a WHOLE array (jobs, people) and the server stores what it
// is sent. These models declare a fixed set of fields, so anything they don't —
// #228's planned-vs-actual fields, depsMode, finish requests, a job's colour
// extras, a person's department, the #295 permission keys — was dropped for every
// client by any Android save. This is iOS's JSONPassthrough, for Gson.
//
// A model opts in by implementing [Passthrough] with a `@Transient` `extras`
// property (transient, so Gson's own field adapter never sees it). On READ, the
// factory keeps every key of the incoming object that the model can't carry:
//   • a key the model doesn't declare at all, and
//   • a key it declares but can't REPRESENT — an enum value it has no case for
//     ("MTX FAT", "On time") reads as null and would write as nothing (#447, #518).
// On WRITE, those keys go back in wherever the model's own output lacks them, so a
// field the app actually set always wins over the stale captured value.
//
// A declared field that read fine and was then cleared by the app (a dueDate set to
// null) is NOT in `extras`, so clearing still works.
//
// NOT COMPILED: this machine has no JDK or Android SDK. Checked by source shape in
// scripts/native-id-status-test.mjs only.

/** A model that carries the JSON keys it doesn't model, see [PassthroughAdapterFactory]. */
interface Passthrough {
    val extras: JsonObject?
}

object PassthroughAdapterFactory : TypeAdapterFactory {
    override fun <T> create(gson: Gson, type: TypeToken<T>): TypeAdapter<T>? {
        val raw = type.rawType
        if (!Passthrough::class.java.isAssignableFrom(raw)) return null
        val delegate = gson.getDelegateAdapter(this, type)
        val elements = gson.getAdapter(JsonElement::class.java)
        val declared = declaredNames(raw)
        val extrasField = raw.getDeclaredField("extras").apply { isAccessible = true }

        return object : TypeAdapter<T>() {
            override fun write(out: JsonWriter, value: T?) {
                if (value == null) { out.nullValue(); return }
                val tree = delegate.toJsonTree(value)
                val kept = (value as Passthrough).extras
                if (tree.isJsonObject && kept != null) {
                    val obj = tree.asJsonObject
                    for ((k, v) in kept.entrySet()) if (!obj.has(k)) obj.add(k, v)
                }
                elements.write(out, tree)
            }

            override fun read(reader: JsonReader): T? {
                val el = elements.read(reader) ?: return null
                val value = delegate.fromJsonTree(el) ?: return null
                if (!el.isJsonObject) return value
                // What the model would write for what it just read: a declared key
                // missing from this, but non-null in the input, was unrepresentable.
                val readBack = delegate.toJsonTree(value).let { if (it.isJsonObject) it.asJsonObject else JsonObject() }
                val keep = JsonObject()
                for ((k, v) in el.asJsonObject.entrySet()) {
                    if (k !in declared || (!v.isJsonNull && !readBack.has(k))) keep.add(k, v)
                }
                if (keep.size() > 0) extrasField.set(value, keep)
                return value
            }
        }
    }

    /** The JSON names Gson's field adapter reads and writes for [c]. */
    private fun declaredNames(c: Class<*>): Set<String> =
        c.declaredFields
            .filter { !Modifier.isStatic(it.modifiers) && !Modifier.isTransient(it.modifiers) }
            .map { it.getAnnotation(SerializedName::class.java)?.value ?: it.name }
            .toSet()
}
