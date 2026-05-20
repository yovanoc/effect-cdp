/**
 * Shared cross-domain types that codegen extracts from cyclic references.
 *
 * Extraction rule: If TypeA (in DomainA) references TypeB (in DomainB) AND
 * TypeB references TypeA — both form a cycle across domain boundary → both
 * are extracted here.
 *
 * Non-cyclic cross-domain refs emit `import` statements instead.
 *
 * DO NOT EDIT MANUALLY below the AUTO-GENERATED ANCHOR.
 * The section above the anchor is the manual seed; codegen appends below it.
 */

export {}; // placeholder — codegen appends real exports below the anchor

// AUTO-GENERATED ANCHOR — codegen appends below this line
