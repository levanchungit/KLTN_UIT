"""
Performance Benchmark Script for Chatbot Classification
Measures latency, cache hit rate, and overall system performance
"""
import asyncio
import time
import json
import statistics
from datetime import datetime
from typing import Dict, List, Any
import sys
import os

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.classificationCacheService import (
    classificationCacheService,
    useClassificationCache,
    type CachedPrediction,
)

# Test cases for benchmarking
BENCHMARK_TEST_CASES = [
    "Lương tháng 10 triệu",
    "Cà phê sáng 40k",
    "Grab đi ăn 80k",
    "Mua sắm Shopee 250k",
    "Thuốc cảm 50k",
    "Spotify tháng 47k",
    "Cắt tóc 60k",
    "Xăng xe 200k",
    "Mẹ cho 1 triệu",
    "Tiền điện 350k",
]

def generate_mock_prediction(text: str, index: int) -> CachedPrediction:
    """Generate mock prediction for testing"""
    return {
        amount: 100000 + (index * 10000),
        categoryId: f"cat_{index % 5}",
        categoryName: ["Ăn uống", "Di chuyển", "Mua sắm", "Giải trí", "Sức khỏe"][index % 5],
        io: "OUT" if index % 3 != 0 else "IN",
        confidence: 0.85 + (index % 10) / 100,
        note: text,
        date: datetime.now().isoformat(),
        isMultiple: False,
        message: f"Đã ghi chi 100000đ cho {text}",
        overallConfidence: 0.9,
        source: "llm",
    }

async def benchmark_cache_service():
    """Benchmark the classification cache service"""
    print("\n" + "="*60)
    print("BENCHMARK: Classification Cache Service")
    print("="*60)
    
    # Clear cache before testing
    await classificationCacheService.clearCache()
    
    # Test metrics
    cache_hits = 0
    cache_misses = 0
    latencies = []
    
    # First pass: populate cache (cache misses expected)
    print("\n📝 Phase 1: Populating cache (first pass)...")
    for i, text in enumerate(BENCHMARK_TEST_CASES):
        start = time.perf_counter()
        result = await classificationCacheService.getCachedResult(text)
        elapsed = (time.perf_counter() - start) * 1000  # ms
        
        if result:
            cache_hits += 1
            print(f"  ❌ Unexpected hit: {text[:30]}...")
        else:
            cache_misses += 1
            # Populate cache
            prediction = generate_mock_prediction(text, i)
            await classificationCacheService.cacheResult(text, prediction)
            print(f"  ✓ Cached: {text[:30]}... ({elapsed:.2f}ms)")
        
        latencies.append(elapsed)
    
    print(f"\nPhase 1 Results:")
    print(f"  - Total requests: {len(BENCHMARK_TEST_CASES)}")
    print(f"  - Cache misses: {cache_misses}")
    print(f"  - Avg latency: {statistics.mean(latencies):.2f}ms")
    
    # Second pass: test cache hits
    print("\n📝 Phase 2: Testing cache hits (second pass)...")
    cache_hits = 0
    cache_misses = 0
    latencies = []
    
    for i, text in enumerate(BENCHMARK_TEST_CASES):
        start = time.perf_counter()
        result = await classificationCacheService.getCachedResult(text)
        elapsed = (time.perf_counter() - start) * 1000  # ms
        
        if result:
            cache_hits += 1
            print(f"  ✓ Cache HIT: {text[:30]}... ({elapsed:.2f}ms)")
        else:
            cache_misses += 1
            print(f"  ❌ Cache MISS: {text[:30]}...")
        
        latencies.append(elapsed)
    
    # Calculate cache hit rate
    total_requests = cache_hits + cache_misses
    hit_rate = (cache_hits / total_requests * 100) if total_requests > 0 else 0
    
    print(f"\nPhase 2 Results:")
    print(f"  - Total requests: {total_requests}")
    print(f"  - Cache hits: {cache_hits}")
    print(f"  - Cache misses: {cache_misses}")
    print(f"  - Cache hit rate: {hit_rate:.1f}%")
    print(f"  - Avg latency: {statistics.mean(latencies):.2f}ms")
    print(f"  - Min latency: {min(latencies):.2f}ms")
    print(f"  - Max latency: {max(latencies):.2f}ms")
    print(f"  - Std deviation: {statistics.stdev(latencies):.2f}ms" if len(latencies) > 1 else "")
    
    # Get cache stats
    stats = await classificationCacheService.getCacheStats()
    print(f"\nCache Statistics:")
    print(f"  - Total entries: {stats.totalEntries}")
    print(f"  - Total hits (all time): {stats.totalHits}")
    print(f"  - Hit rate (all time): {stats.hitRate:.1f}%")
    
    return {
        "phase1": {
            "total": len(BENCHMARK_TEST_CASES),
            "misses": cache_misses,
            "avg_latency_ms": statistics.mean(latencies) if latencies else 0,
        },
        "phase2": {
            "total": total_requests,
            "hits": cache_hits,
            "misses": cache_misses,
            "hit_rate_percent": hit_rate,
            "avg_latency_ms": statistics.mean(latencies) if latencies else 0,
            "min_latency_ms": min(latencies) if latencies else 0,
            "max_latency_ms": max(latencies) if latencies else 0,
        },
        "cache_stats": stats,
    }

async def benchmark_llm_classification():
    """Benchmark LLM classification with optimized prompt"""
    print("\n" + "="*60)
    print("BENCHMARK: LLM Classification (Optimized Prompt)")
    print("="*60)
    
    try:
        from services.llm_service import get_llm_service
        from prompts.system_prompts import FAST_SYSTEM_PROMPT
        
        llm_service = get_llm_service()
        
        # Test if LLM is available
        if not llm_service.is_available():
            print("⚠️ LLM server not available, skipping benchmark")
            return None
        
        print("\n📝 Testing LLM classification with FAST_SYSTEM_PROMPT...")
        print(f"Prompt length: {len(FAST_SYSTEM_PROMPT)} characters")
        
        latencies = []
        results = []
        
        for i, text in enumerate(BENCHMARK_TEST_CASES[:5]):  # Test subset for speed
            print(f"\n  Testing: {text}...")
            
            start = time.perf_counter()
            try:
                response = llm_service.get_prediction(
                    system_prompt=FAST_SYSTEM_PROMPT,
                    user_prompt=f'Phân tích giao dịch: "{text}"\n\nJSON:',
                    temperature=0.0
                )
                elapsed = (time.perf_counter() - start) * 1000
                latencies.append(elapsed)
                
                print(f"    ✓ Response time: {elapsed:.2f}ms")
                print(f"    📄 Response: {response[:100]}...")
                
                results.append({
                    "text": text,
                    "latency_ms": elapsed,
                    "response": response[:200],
                })
            except Exception as e:
                elapsed = (time.perf_counter() - start) * 1000
                latencies.append(elapsed)
                print(f"    ❌ Error: {e}")
                
                results.append({
                    "text": text,
                    "latency_ms": elapsed,
                    "error": str(e),
                })
        
        print(f"\n📊 LLM Classification Results:")
        print(f"  - Total tests: {len(results)}")
        print(f"  - Successful: {len([r for r in results if 'error' not in r])}")
        print(f"  - Avg latency: {statistics.mean(latencies):.2f}ms")
        print(f"  - Min latency: {min(latencies):.2f}ms")
        print(f"  - Max latency: {max(latencies):.2f}ms")
        
        # Get cache stats
        cache_stats = llm_service.get_cache_stats()
        print(f"\n📦 LLM Response Cache:")
        print(f"  - Cache size: {cache_stats['size']}/{cache_stats['max_size']}")
        
        return {
            "total_tests": len(results),
            "successful": len([r for r in results if 'error' not in r]),
            "latency_stats": {
                "avg_ms": statistics.mean(latencies),
                "min_ms": min(latencies),
                "max_ms": max(latencies),
            },
            "cache_stats": cache_stats,
            "results": results,
        }
        
    except Exception as e:
        print(f"❌ Error during LLM benchmark: {e}")
        return None

async def benchmark_end_to_end():
    """Benchmark end-to-end classification flow"""
    print("\n" + "="*60)
    print("BENCHMARK: End-to-End Classification Flow")
    print("="*60)
    
    print("\n📝 Simulating end-to-end flow with cache...")
    
    # Simulate real-world usage pattern
    usage_pattern = (
        BENCHMARK_TEST_CASES[:3] +  # First-time requests (cache miss)
        BENCHMARK_TEST_CASES[:3] +  # Repeated requests (cache hit)
        BENCHMARK_TEST_CASES[3:6] +  # New requests (cache miss)
        BENCHMARK_TEST_CASES[:3] +  # Repeated again (cache hit)
        BENCHMARK_TEST_CASES[6:]    # More new requests (cache miss)
    )
    
    # Clear cache first
    await classificationCacheService.clearCache()
    
    latencies = []
    cache_hits = 0
    cache_misses = 0
    
    for i, text in enumerate(usage_pattern):
        start = time.perf_counter()
        
        # Try cache first
        result = await classificationCacheService.getCachedResult(text)
        
        if result:
            cache_hits += 1
            elapsed = (time.perf_counter() - start) * 1000
            latencies.append(elapsed)
            print(f"  ✓ [{i+1}/{len(usage_pattern)}] Cache HIT: {text[:25]}... ({elapsed:.2f}ms)")
        else:
            # Simulate LLM call
            await asyncio.sleep(0.1)  # Simulate ~100ms LLM latency
            cache_misses += 1
            elapsed = (time.perf_counter() - start) * 1000 + 100
            latencies.append(elapsed)
            
            # Cache the result
            prediction = generate_mock_prediction(text, i)
            await classificationCacheService.cacheResult(text, prediction)
            print(f"  ✓ [{i+1}/{len(usage_pattern)}] Cache MISS (LLM): {text[:25]}... ({elapsed:.2f}ms)")
    
    total = len(usage_pattern)
    hit_rate = cache_hits / total * 100 if total > 0 else 0
    
    print(f"\n📊 End-to-End Results:")
    print(f"  - Total requests: {total}")
    print(f"  - Cache hits: {cache_hits} ({hit_rate:.1f}%)")
    print(f"  - Cache misses: {cache_misses} ({100-hit_rate:.1f}%)")
    print(f"  - Avg latency: {statistics.mean(latencies):.2f}ms")
    print(f"  - Expected improvement: ~{hit_rate:.0f}% faster on repeated requests")
    
    return {
        "total_requests": total,
        "cache_hits": cache_hits,
        "cache_misses": cache_misses,
        "hit_rate_percent": hit_rate,
        "avg_latency_ms": statistics.mean(latencies),
        "min_latency_ms": min(latencies),
        "max_latency_ms": max(latencies),
    }

async def main():
    """Run all benchmarks"""
    print("\n" + "="*60)
    print("🚀 CHATBOT PERFORMANCE BENCHMARK")
    print("="*60)
    print(f"Timestamp: {datetime.now().isoformat()}")
    print(f"Test cases: {len(BENCHMARK_TEST_CASES)}")
    
    results = {
        "timestamp": datetime.now().isoformat(),
        "test_cases_count": len(BENCHMARK_TEST_CASES),
        "benchmarks": {},
    }
    
    # Run benchmarks
    results["benchmarks"]["cache_service"] = await benchmark_cache_service()
    results["benchmarks"]["llm_classification"] = await benchmark_llm_classification()
    results["benchmarks"]["end_to_end"] = await benchmark_end_to_end()
    
    # Summary
    print("\n" + "="*60)
    print("📋 SUMMARY")
    print("="*60)
    
    if results["benchmarks"]["cache_service"]:
        cache_results = results["benchmarks"]["cache_service"]["phase2"]
        print(f"\n🔹 Cache Performance:")
        print(f"   Hit Rate: {cache_results['hit_rate_percent']:.1f}%")
        print(f"   Avg Latency: {cache_results['avg_latency_ms']:.2f}ms")
    
    if results["benchmarks"]["llm_classification"]:
        llm_results = results["benchmarks"]["llm_classification"]
        if llm_results and "latency_stats" in llm_results:
            print(f"\n🔹 LLM Performance:")
            print(f"   Avg Latency: {llm_results['latency_stats']['avg_ms']:.2f}ms")
            print(f"   Success Rate: {llm_results['successful']}/{llm_results['total_tests']}")
    
    if results["benchmarks"]["end_to_end"]:
        e2e_results = results["benchmarks"]["end_to_end"]
        print(f"\n🔹 End-to-End Performance:")
        print(f"   Cache Hit Rate: {e2e_results['hit_rate_percent']:.1f}%")
        print(f"   Avg Latency: {e2e_results['avg_latency_ms']:.2f}ms")
        print(f"   Expected Speedup: ~{e2e_results['hit_rate_percent']:.0f}% on repeated queries")
    
    # Save results to file
    output_file = f"benchmark_results_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    
    print(f"\n💾 Results saved to: {output_file}")
    
    # Cleanup
    await classificationCacheService.clearCache()
    
    return results

if __name__ == "__main__":
    asyncio.run(main())
