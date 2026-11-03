#!/usr/bin/env python3
"""Independent public-record verifier for Ballot Lab's local research protocol.

Uses Python 3.9+ standard library only. Does not import or execute the JavaScript
verifier. This is NOT a Midnight ledger verifier or an independent security audit.
Verification requires no private voter keys or trustee secret shares.

Protocol: RFC 3526 group 14 prime-order subgroup; exponential ElGamal;
Fiat-Shamir disjunctive Chaum-Pedersen bit proofs; one-selection DLEQ proof;
Schnorr ballot authorization; 2-of-3 threshold decryption with DLEQ proofs.
The exact transcript formats are specific to ballot-lab/*/v1.
"""

import argparse
import functools
import hashlib
import json
import re
import sys
from pathlib import Path

P = int("""
FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD1
29024E088A67CC74020BBEA63B139B22514A08798E3404DD
EF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245
E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED
EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3D
C2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F
83655D23DCA3AD961C62F356208552BB9ED529077096966D
670C354E4ABC9804F1746C08CA18217C32905E462E36CE3B
E39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9
DE2BCBF6955817183995497CEA956AE515D2261898FA0510
15728E5A8AACAA68FFFFFFFFFFFFFFFF
""".replace("\n", ""), 16)
Q = (P - 1) // 2
G = 2
GROUP = "rfc3526-group14-q-subgroup"
SCHEMA = {name: f"ballot-lab/{name}/v1" for name in
          ("manifest", "ballot", "decryption-share", "record")}
HEX = re.compile(r"[0-9a-f]{512}\Z", re.ASCII)
DIGEST = re.compile(r"[0-9a-f]{64}\Z", re.ASCII)
MANIFEST_KEYS = ("schema", "group", "electionId", "title", "candidates",
                 "maxBallots", "threshold", "trustees", "voterPublicKeys",
                 "keyCommitments")
BALLOT_KEYS = ("schema", "electionHash", "nullifier", "voterPublicKey",
               "ciphertexts", "bitProofs", "sumProof", "signature", "id")
AGGREGATE_KEYS = ("electionHash", "ballotSetHash", "count", "ciphertexts")
MAX_BYTES = 64 * 1024 * 1024
JS_TRIM = "\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"


class InvalidRecord(ValueError):
    """A record failed a structural or cryptographic check."""


def require(condition, message):
    if not condition:
        raise InvalidRecord(message)


def fields(value, keys, label):
    require(type(value) is dict and set(value) == set(keys),
            f"{label}: unexpected or missing fields")


def integer(value, minimum, maximum, label):
    require(type(value) is int and minimum <= value <= maximum,
            f"{label}: invalid integer")
    return value


def vector(value, length, label):
    require(type(value) is list and len(value) == length,
            f"{label}: invalid vector length")


def text(value, label, minimum=1, maximum=160):
    require(type(value) is str, f"{label}: invalid text")
    length = len(value.encode("utf-16-le", errors="surrogatepass")) // 2
    require(minimum <= length <= maximum and value == value.strip(JS_TRIM),
            f"{label}: invalid text")
    require(not any(ord(c) < 32 or ord(c) == 127 for c in value),
            f"{label}: control characters are forbidden")


def digest(value, label):
    require(type(value) is str and DIGEST.fullmatch(value) is not None,
            f"{label}: invalid SHA-256 digest")
    return value


def hex_integer(value, label):
    require(type(value) is str and HEX.fullmatch(value) is not None,
            f"{label}: expected canonical 512-digit lowercase hex")
    return int(value, 16)


def hx(value):
    return format(value, "0512x")


def scalar(value, label="scalar"):
    result = hex_integer(value, label)
    require(result < Q, f"{label}: scalar out of range")
    return result


@functools.lru_cache(maxsize=4096)
def in_subgroup(value):
    return pow(value, Q, P) == 1


def element(value, label="group element", nonidentity=False):
    result = hex_integer(value, label)
    require(0 < result < P and (not nonidentity or result != 1),
            f"{label}: group element out of range")
    require(in_subgroup(result), f"{label}: not in prime-order subgroup")
    return result


def json_string(value):
    # JSON.stringify emits Unicode directly, except lone UTF-16 surrogates.
    encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return "".join(f"\\u{ord(c):04x}" if 0xD800 <= ord(c) <= 0xDFFF else c
                   for c in encoded)


def canonical(value):
    if value is None:
        return "null"
    if type(value) is bool:
        return "true" if value else "false"
    if type(value) is str:
        return json_string(value)
    if type(value) is int:
        require(abs(value) <= 9007199254740991, "Unsafe JSON integer")
        return str(value)
    if type(value) is list:
        return "[" + ",".join(canonical(v) for v in value) + "]"
    require(type(value) is dict and all(type(k) is str for k in value),
            "Unsupported JSON value")
    # ECMAScript Object.keys(...).sort() uses UTF-16 code-unit order.
    keys = sorted(value, key=lambda k: k.encode("utf-16-be", errors="surrogatepass"))
    return "{" + ",".join(json_string(k) + ":" + canonical(value[k]) for k in keys) + "}"


def hash_value(domain, *values):
    transcript = canonical(["midnight-ballot-lab-v1", domain, *values])
    return hashlib.sha256(transcript.encode("utf-8")).hexdigest()


def challenge(domain, *values):
    return int(hash_value(domain, *values), 16)


def verify_dleq(domain, context, base, y, target, proof):
    fields(proof, ("c", "z"), "DLEQ proof")
    c, z = scalar(proof["c"]), scalar(proof["z"])
    t1 = pow(G, z, P) * pow(pow(y, c, P), -1, P) % P
    t2 = pow(base, z, P) * pow(pow(target, c, P), -1, P) % P
    expected = challenge(domain, context, hx(base), hx(y), hx(target), hx(t1), hx(t2))
    require(c == expected, "DLEQ proof failed")


def verify_bit(context, y, a, b, proof):
    fields(proof, ("c0", "z0", "c1", "z1"), "Bit proof")
    cs = [scalar(proof["c0"]), scalar(proof["c1"])]
    zs = [scalar(proof["z0"]), scalar(proof["z1"])]
    t1, t2 = [], []
    for bit in (0, 1):
        target = b * pow(pow(G, bit, P), -1, P) % P
        t1.append(hx(pow(G, zs[bit], P) * pow(pow(a, cs[bit], P), -1, P) % P))
        t2.append(hx(pow(y, zs[bit], P) * pow(pow(target, cs[bit], P), -1, P) % P))
    expected = challenge("bit-or", context, hx(y), hx(a), hx(b), t1, t2)
    require((cs[0] + cs[1]) % Q == expected, "Ballot bit proof failed")


def verify_signature(context, public_key, signature):
    fields(signature, ("c", "z"), "Credential signature")
    c, z = scalar(signature["c"]), scalar(signature["z"])
    commitment = pow(G, z, P) * pow(pow(public_key, c, P), -1, P) % P
    expected = challenge("credential-signature", context, hx(public_key), hx(commitment))
    require(c == expected, "Credential signature failed")


def validate_manifest(manifest):
    fields(manifest, MANIFEST_KEYS, "Manifest")
    require(manifest["schema"] == SCHEMA["manifest"] and manifest["group"] == GROUP,
            "Unsupported manifest schema or cryptographic group")
    text(manifest["electionId"], "Election ID", maximum=128)
    text(manifest["title"], "Election title")
    candidates = manifest["candidates"]
    require(type(candidates) is list, "Candidates must be an array")
    integer(len(candidates), 2, 5, "Candidate count")
    for candidate in candidates:
        text(candidate, "Candidate label", maximum=80)
    require(len(set(candidates)) == len(candidates), "Candidate labels must be unique")
    maximum = integer(manifest["maxBallots"], 1, 1000, "Maximum ballots")
    integer(manifest["threshold"], 2, 2, "Threshold")
    vector(manifest["keyCommitments"], 2, "Key commitments")
    c0, c1 = [element(v, "Key commitment", True) for v in manifest["keyCommitments"]]
    vector(manifest["trustees"], 3, "Trustees")
    trustee_keys = []
    for index, trustee in enumerate(manifest["trustees"], 1):
        fields(trustee, ("index", "publicKey"), "Trustee")
        integer(trustee["index"], index, index, "Trustee index")
        public_key = element(trustee["publicKey"], "Trustee public key", True)
        require(public_key == c0 * pow(c1, index, P) % P,
                "Trustee key is inconsistent with threshold commitments")
        trustee_keys.append(public_key)
    require(len(set(trustee_keys)) == 3, "Trustee keys must be distinct")
    voters = manifest["voterPublicKeys"]
    require(type(voters) is list, "Voter keys must be an array")
    integer(len(voters), 1, maximum, "Voter count")
    for key in voters:
        element(key, "Voter public key", True)
    require(len(set(voters)) == len(voters), "Duplicate eligible voter credentials")


def verify_ballot(manifest, election_hash, ballot):
    fields(ballot, BALLOT_KEYS, "Ballot")
    require(ballot["schema"] == SCHEMA["ballot"], "Unsupported ballot schema")
    for name in ("id", "electionHash", "nullifier"):
        digest(ballot[name], f"Ballot {name}")
    require(ballot["electionHash"] == election_hash, "Ballot belongs to a different election")
    require(ballot["voterPublicKey"] in manifest["voterPublicKeys"], "Ballot credential is not eligible")
    public_key = element(ballot["voterPublicKey"], "Voter public key", True)
    nullifier = hash_value("credential-nullifier", election_hash, ballot["voterPublicKey"])
    require(ballot["nullifier"] == nullifier, "Invalid election-scoped nullifier")
    receipt_body = {k: v for k, v in ballot.items() if k != "id"}
    require(ballot["id"] == hash_value("ballot-receipt", receipt_body), "Ballot fingerprint does not match content")
    signed_body = {k: v for k, v in ballot.items() if k not in ("id", "signature")}
    verify_signature(hash_value("signed-ballot", signed_body), public_key, ballot["signature"])
    candidate_count = len(manifest["candidates"])
    vector(ballot["ciphertexts"], candidate_count, "Ciphertexts")
    vector(ballot["bitProofs"], candidate_count, "Bit proofs")
    context = {"electionHash": election_hash, "nullifier": nullifier,
               "voterPublicKey": ballot["voterPublicKey"]}
    y = element(manifest["keyCommitments"][0])
    ciphertexts = []
    sum_a, sum_b = 1, 1
    for index, ciphertext in enumerate(ballot["ciphertexts"]):
        fields(ciphertext, ("a", "b"), "Ciphertext")
        a = element(ciphertext["a"], "Ciphertext a", True)
        b = element(ciphertext["b"], "Ciphertext b")
        verify_bit({**context, "candidateIndex": index}, y, a, b, ballot["bitProofs"][index])
        sum_a = sum_a * a % P
        sum_b = sum_b * b % P
        ciphertexts.append((a, b))
    verify_dleq("one-selection", {**context, "ciphertexts": ballot["ciphertexts"]},
                y, sum_a, sum_b * pow(G, -1, P) % P, ballot["sumProof"])
    return ciphertexts


def aggregate_ballots(manifest, election_hash, ballots):
    require(type(ballots) is list and len(ballots) <= manifest["maxBallots"],
            "Invalid or oversized ballot list")
    identifiers, nullifiers = set(), set()
    products = [[1, 1] for _ in manifest["candidates"]]
    for ballot in ballots:
        ciphertexts = verify_ballot(manifest, election_hash, ballot)
        require(ballot["id"] not in identifiers, "Duplicate ballot fingerprint")
        require(ballot["nullifier"] not in nullifiers, "Duplicate voter credential/nullifier")
        identifiers.add(ballot["id"])
        nullifiers.add(ballot["nullifier"])
        for product, (a, b) in zip(products, ciphertexts):
            product[0] = product[0] * a % P
            product[1] = product[1] * b % P
    return {
        "electionHash": election_hash,
        "ballotSetHash": hash_value("accepted-ballot-set", election_hash, sorted(identifiers)),
        "count": len(ballots),
        "ciphertexts": [{"a": hx(a), "b": hx(b)} for a, b in products],
    }


def verify_share(manifest, aggregate, share):
    fields(share, ("schema", "electionHash", "ballotSetHash", "trusteeIndex", "values"), "Decryption share")
    require(share["schema"] == SCHEMA["decryption-share"], "Unsupported decryption-share schema")
    require(share["electionHash"] == aggregate["electionHash"] and
            share["ballotSetHash"] == aggregate["ballotSetHash"],
            "Decryption share is for another election or ballot set")
    index = integer(share["trusteeIndex"], 1, 3, "Trustee index")
    public_key = element(manifest["trustees"][index - 1]["publicKey"], "Trustee public key", True)
    vector(share["values"], len(manifest["candidates"]), "Decryption share values")
    for candidate, value in enumerate(share["values"]):
        fields(value, ("value", "proof"), "Partial decryption")
        decryption = element(value["value"], "Partial decryption")
        base = element(aggregate["ciphertexts"][candidate]["a"])
        context = {"aggregate": aggregate, "trusteeIndex": index, "candidateIndex": candidate}
        verify_dleq("threshold-share", context, base, public_key, decryption, value["proof"])


def decrypt_tally(manifest, aggregate, shares):
    require(type(shares) is list and 2 <= len(shares) <= 3,
            "Two or three distinct trustee shares are required")
    for share in shares:
        verify_share(manifest, aggregate, share)
    indices = [s["trusteeIndex"] for s in shares]
    require(len(set(indices)) == len(indices), "Duplicate trustee shares")
    coefficients = {}
    for index in indices:
        coefficient = 1
        for other in indices:
            if other != index:
                coefficient = coefficient * other * pow((other - index) % Q, -1, Q) % Q
        coefficients[index] = coefficient
    tally = []
    for candidate, ciphertext in enumerate(aggregate["ciphertexts"]):
        combined = 1
        for share in shares:
            decryption = element(share["values"][candidate]["value"])
            combined = combined * pow(decryption, coefficients[share["trusteeIndex"]], P) % P
        plaintext = element(ciphertext["b"]) * pow(combined, -1, P) % P
        encoded = 1
        for count in range(aggregate["count"] + 1):
            if encoded == plaintext:
                tally.append(count)
                break
            encoded = encoded * G % P
        else:
            raise InvalidRecord("Decrypted tally is outside the accepted ballot count")
    require(sum(tally) == aggregate["count"], "Tally does not equal accepted ballot count")
    return tally


def verify_record(record, expected_manifest_hash=None, expected_record_hash=None):
    result = {
        "verifier": "ballot-lab/python-reference/v1", "valid": False,
        "anchored": False, "manifestAnchored": False, "recordAnchored": False,
        "checks": [], "errors": [], "warnings": [], "tally": None,
        "ballotCount": 0, "manifestHash": None, "recordHash": None,
    }
    def check(name):
        result["checks"].append({"name": name, "valid": True})
    try:
        fields(record, ("schema", "manifest", "manifestHash", "ballots", "aggregate", "shares", "tally"), "Election record")
        require(record["schema"] == SCHEMA["record"], "Unsupported election-record schema")
        manifest = record["manifest"]
        validate_manifest(manifest)
        election_hash = hash_value("election-manifest", manifest)
        result["manifestHash"] = election_hash
        require(record["manifestHash"] == election_hash, "Manifest fingerprint mismatch")
        if expected_manifest_hash is not None:
            digest(expected_manifest_hash, "Expected election fingerprint")
            require(expected_manifest_hash == election_hash, "Election does not match independently trusted manifest fingerprint")
            result["manifestAnchored"] = True
        check("Election rules and threshold public keys are consistent")
        aggregate = aggregate_ballots(manifest, election_hash, record["ballots"])
        result["ballotCount"] = aggregate["count"]
        check("All ballot signatures, eligibility entries and zero-knowledge proofs are valid")
        check("Each pseudonymous credential contributes at most one accepted ballot")
        fields(record["aggregate"], AGGREGATE_KEYS, "Recorded aggregate")
        require(canonical(record["aggregate"]) == canonical(aggregate), "Published encrypted aggregate does not match all accepted ballots")
        check("Encrypted aggregate matches complete published ballot set")
        tally = decrypt_tally(manifest, aggregate, record["shares"])
        vector(record["tally"], len(manifest["candidates"]), "Published tally")
        for count in record["tally"]:
            integer(count, 0, aggregate["count"], "Candidate total")
        require(tally == record["tally"], "Published tally does not match verified threshold decryption")
        check("Threshold decryption proofs and final totals are correct")
        result["tally"] = tally
        record_hash = hash_value("final-election-record", record)
        result["recordHash"] = record_hash
        if expected_record_hash is not None:
            digest(expected_record_hash, "Expected final-record fingerprint")
            require(expected_record_hash == record_hash, "Record does not match independently trusted final-record fingerprint")
            result["recordAnchored"] = True
        result["anchored"] = result["manifestAnchored"] and result["recordAnchored"]
        if not result["manifestAnchored"]:
            result["warnings"].append("No independently trusted manifest fingerprint supplied; election definition is not authenticated.")
        if not result["recordAnchored"]:
            result["warnings"].append("No independently trusted final-record fingerprint supplied; completeness relative to an external bulletin board is not established.")
        result["warnings"].append("Local research protocol only; no Midnight ledger inclusion or national-election security is established.")
        result["valid"] = True
    except (InvalidRecord, TypeError, ValueError, OverflowError, RecursionError) as error:
        result["errors"].append(str(error))
        result["checks"].append({"name": str(error), "valid": False})
    return result


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "Duplicate JSON object field")
        result[key] = value
    return result


def reject_float(value):
    raise InvalidRecord("Fractional or exponent-form JSON numbers are not accepted")


def parse_integer(value):
    require(value != "-0", "Negative zero is not canonical")
    require(len(value.lstrip("-")) <= 16, "Unsafe JSON integer")
    parsed = int(value)
    require(abs(parsed) <= 9007199254740991, "Unsafe JSON integer")
    return parsed


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("record", help="Public election-record JSON path, or - for stdin")
    parser.add_argument("--expected-manifest-hash", help="Independently trusted election SHA-256 fingerprint")
    parser.add_argument("--expected-record-hash", help="Independently trusted final-record SHA-256 fingerprint")
    args = parser.parse_args()
    try:
        if args.record == "-":
            raw = sys.stdin.buffer.read(MAX_BYTES + 1)
        else:
            with Path(args.record).open("rb") as stream:
                raw = stream.read(MAX_BYTES + 1)
        require(len(raw) <= MAX_BYTES, "Election record exceeds the 64 MiB input limit")
        record = json.loads(raw.decode("utf-8"), object_pairs_hook=unique_object,
                            parse_int=parse_integer, parse_float=reject_float,
                            parse_constant=reject_float)
        result = verify_record(record, args.expected_manifest_hash, args.expected_record_hash)
    except (OSError, UnicodeError, ValueError, RecursionError) as error:
        result = {"verifier": "ballot-lab/python-reference/v1", "valid": False,
                  "anchored": False, "errors": [str(error)]}
    print(json.dumps(result, ensure_ascii=True, indent=2))
    return 0 if result["valid"] else 1


if __name__ == "__main__":
    sys.exit(main())
